// Read-ahead speech recognition through Cloudflare Workers AI's Whisper
// (`@cf/openai/whisper-large-v3-turbo`), the second Whisper service after Groq
// (ADR 0002). The free plan allows 10,000 Neurons a day, reset at 00:00 UTC;
// this model costs 46.63 Neurons per audio minute, about 3.5 hours of audio a
// day. Its answer nests the words in segments, and is shaped into sentences
// the same way as Groq's.
import {
  CHUNK_REQUEST_TIMEOUT_MS,
  ChunkTranslationError,
  withRequestTimeout,
} from './gemini-chunk-translation';
import {
  isWord,
  sentencesFromWords,
  speechWords,
  whisperLanguageCode,
  type GroqWord,
  type RecognizedChunk,
  type WhisperSegment,
} from './groq-transcription';

export const CLOUDFLARE_MODEL = '@cf/openai/whisper-large-v3-turbo';
export const CLOUDFLARE_ORIGIN = 'https://api.cloudflare.com/*';

export interface CloudflareTranscriptionRequest {
  accountId: string;
  apiToken: string;
  // Base64 WAV, 16 kHz mono PCM16.
  audioBase64: string;
  // A Gemini language code, or undefined to let Whisper detect it.
  sourceLanguage?: string;
}

interface CloudflareSegment extends WhisperSegment {
  words?: unknown;
}

interface CloudflareEnvelope {
  errors?: Array<{ code?: number; message?: string }>;
  result?: {
    segments?: unknown;
    transcription_info?: { language?: unknown };
  };
  success?: boolean;
}

function languageOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Usually a code ("en"); a name ("english") is mapped like Groq's.
  return /^[a-z]{2,3}$/i.test(value) ? value.toLowerCase() : whisperLanguageCode(value);
}

async function errorForResponse(response: Response): Promise<ChunkTranslationError> {
  const { status } = response;
  const text = await response.text().catch(() => '');
  if (status === 401 || status === 403) return new ChunkTranslationError('invalid_credentials', status);
  // The daily free allocation of Neurons used up, or a per-minute limit.
  if (status === 429 || /neuron|daily|allocation/i.test(text)) {
    return new ChunkTranslationError(
      /neuron|daily|allocation|per day/i.test(text) ? 'quota_exceeded' : 'rate_limited',
      status,
    );
  }
  return new ChunkTranslationError('provider_unavailable', status);
}

async function requestTranscription(
  request: CloudflareTranscriptionRequest,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<RecognizedChunk> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(request.accountId.trim())}/ai/run/${CLOUDFLARE_MODEL}`;
  let response: Response;
  try {
    response = await fetcher(url, {
      body: JSON.stringify({
        audio: request.audioBase64,
        // Whisper takes ISO 639-1; 'zh-Hant' and 'pt-BR' become 'zh' and 'pt'.
        ...(request.sourceLanguage ? { language: request.sourceLanguage.split('-')[0] } : {}),
        task: 'transcribe',
        // Skips silence before Whisper can invent words over it.
        vad_filter: true,
      }),
      headers: {
        authorization: `Bearer ${request.apiToken}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ChunkTranslationError('network_error');
  }
  if (!response.ok) throw await errorForResponse(response);
  let body: CloudflareEnvelope;
  try {
    body = await response.json() as CloudflareEnvelope;
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ChunkTranslationError('invalid_response');
  }
  if (body.success === false || !body.result) throw new ChunkTranslationError('invalid_response');
  const segments = Array.isArray(body.result.segments)
    ? body.result.segments as CloudflareSegment[]
    : [];
  const words: GroqWord[] = segments.flatMap((segment) =>
    Array.isArray(segment.words) ? segment.words.filter(isWord) : []);
  const language = languageOf(body.result.transcription_info?.language);
  return {
    ...(language ? { language } : {}),
    sentences: sentencesFromWords(speechWords(words, segments)),
  };
}

const globalFetch: typeof fetch = (input, init) => fetch(input, init);

export function transcribeWithCloudflare(
  request: CloudflareTranscriptionRequest,
  fetcher: typeof fetch = globalFetch,
  timeoutMs = CHUNK_REQUEST_TIMEOUT_MS,
): Promise<RecognizedChunk> {
  return withRequestTimeout(
    (signal) => requestTranscription(request, fetcher, signal),
    timeoutMs,
  );
}
