// One read-ahead chunk → one non-Live generateContent request. The model is
// fixed (ADR 0005): a slower one would hold the main player indefinitely.
import { GEMINI_LANGUAGE_OPTIONS } from '../core/gemini-languages';

export const READ_AHEAD_MODEL = 'gemini-flash-lite-latest';
export const READ_AHEAD_SAMPLE_RATE = 16_000;

// A request that has not answered by then is given up. Requests are never
// retried: the viewer may be held while one runs, so the longest a chunk can
// hold the viewer is this, after which its stretch shows "翻譯失敗".
export const CHUNK_REQUEST_TIMEOUT_MS = 7_000;

const ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${READ_AHEAD_MODEL}:generateContent`;

export type ChunkTranslationErrorCode =
  | 'invalid_credentials'
  | 'invalid_response'
  | 'network_error'
  | 'provider_unavailable'
  // A 429 for a daily quota: nothing will succeed until it resets.
  | 'quota_exceeded'
  // Any other 429 (a per-minute limit).
  | 'rate_limited'
  | 'timeout';

export class ChunkTranslationError extends Error {
  constructor(
    public readonly code: ChunkTranslationErrorCode,
    public readonly status?: number,
  ) {
    super(`Read-ahead translation failed: ${code}`);
    this.name = 'ChunkTranslationError';
  }
}

export interface ChunkSentence {
  cut: boolean;
  // Seconds from the start of the chunk.
  end: number;
  original: string;
  sameLanguage: boolean;
  start: number;
  translation: string;
  // Whisper's words with their times (seconds from the start of the chunk);
  // Gemini times only whole sentences.
  words?: Array<{ end: number; start: number; text: string }>;
}

export interface ChunkTranslationRequest {
  apiKey: string;
  // Base64 WAV, 16 kHz mono PCM16.
  audioBase64: string;
  // A Gemini language code, or undefined to let the model detect it.
  sourceLanguage?: string;
  targetLanguage: string;
}

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      start: { type: 'NUMBER' },
      end: { type: 'NUMBER' },
      original: { type: 'STRING' },
      translation: { type: 'STRING' },
      cut: { type: 'BOOLEAN' },
      sameLanguage: { type: 'BOOLEAN' },
    },
    required: ['start', 'end', 'original', 'translation', 'cut', 'sameLanguage'],
  },
} as const;

export function languageName(code: string): string {
  const option = GEMINI_LANGUAGE_OPTIONS.find((item) => item.code === code);
  return option ? `${option.label} (${code})` : code;
}

export function buildChunkPrompt(
  targetLanguage: string,
  sourceLanguage?: string,
): string {
  const target = languageName(targetLanguage);
  const source = sourceLanguage
    ? ` The speech is in ${languageName(sourceLanguage)}.`
    : '';
  return [
    `Transcribe every spoken sentence in this audio and translate it into ${target}.${source}`,
    'For each sentence give start and end as seconds from the beginning of this audio clip, with two decimals.',
    'If a sentence is cut off at the start or end of the clip, still include it and set "cut" to true.',
    `Set "sameLanguage" to true if the sentence is already in ${target}.`,
    'Return an empty array if there is no speech.',
  ].join(' ');
}

async function errorForResponse(response: Response): Promise<ChunkTranslationError> {
  const { status } = response;
  if (status === 400 || status === 401 || status === 403) {
    return new ChunkTranslationError('invalid_credentials', status);
  }
  if (status === 429) {
    return new ChunkTranslationError(
      await isDailyQuota(response) ? 'quota_exceeded' : 'rate_limited',
      status,
    );
  }
  return new ChunkTranslationError('provider_unavailable', status);
}

// Gemini names the exhausted quota in error.details[].violations[].quotaId,
// e.g. "GenerateRequestsPerDayPerProjectPerModel-FreeTier".
async function isDailyQuota(response: Response): Promise<boolean> {
  try {
    const body = await response.json() as {
      error?: { details?: Array<{ violations?: Array<{ quotaId?: unknown }> }> };
    };
    return (body.error?.details ?? []).some((detail) =>
      (detail.violations ?? []).some((violation) =>
        typeof violation.quotaId === 'string' && /PerDay/i.test(violation.quotaId)));
  } catch {
    return false;
  }
}

function isSentence(value: unknown): value is ChunkSentence {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.start === 'number' && Number.isFinite(row.start) &&
    typeof row.end === 'number' && Number.isFinite(row.end) &&
    typeof row.original === 'string' &&
    typeof row.translation === 'string';
}

export function translateChunk(
  request: ChunkTranslationRequest,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  timeoutMs = CHUNK_REQUEST_TIMEOUT_MS,
): Promise<ChunkSentence[]> {
  return withRequestTimeout(
    (abort) => requestChunk(request, fetcher, abort),
    timeoutMs,
    signal,
  );
}

// Rejects with Error(code) if `promise` has not settled within `timeoutMs`,
// for steps that take no AbortSignal (a runtime message, Chrome's Translator).
export function withDeadline<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), timeoutMs);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// Runs a request that is aborted, and rejected with a 'timeout'
// ChunkTranslationError, once `timeoutMs` has passed; the rejection does not
// wait for a fetch that ignores its signal.
export async function withRequestTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', onAbort);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ChunkTranslationError('timeout'));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function requestChunk(
  request: ChunkTranslationRequest,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<ChunkSentence[]> {
  let response: Response;
  try {
    response = await fetcher(ENDPOINT, {
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { data: request.audioBase64, mimeType: 'audio/wav' } },
            { text: buildChunkPrompt(request.targetLanguage, request.sourceLanguage) },
          ],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': request.apiKey,
      },
      method: 'POST',
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ChunkTranslationError('network_error');
  }
  if (!response.ok) throw await errorForResponse(response);

  let rows: unknown;
  try {
    const body = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    rows = JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ChunkTranslationError('invalid_response');
  }
  if (!Array.isArray(rows)) throw new ChunkTranslationError('invalid_response');
  return rows.filter(isSentence).map((row) => ({
    cut: row.cut === true,
    end: Math.max(row.start, row.end),
    original: row.original.trim(),
    sameLanguage: row.sameLanguage === true,
    start: row.start,
    translation: row.translation.trim(),
  }));
}

// WAV is what the spike measured; 16 kHz mono keeps a 15 s chunk under 500 KB.
export function encodeWav(
  samples: Int16Array,
  sampleRate = READ_AHEAD_SAMPLE_RATE,
): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      bytes[offset + index] = text.charCodeAt(index);
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(44 + index * 2, samples[index]!, true);
  }
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
