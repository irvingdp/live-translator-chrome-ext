// Read-ahead speech recognition through Groq's Whisper (issue #11): one chunk
// → one transcription request with word timestamps, turned into sentences the
// session can pin to media time. Translation is a separate step (Chrome's
// built-in Translator, else Google's web translation). Whisper gives words,
// not sentences; the words carry their punctuation, so sentences end at a word
// that ends one.
import { isWideCharacter } from '../core/sentence-splitter';
import {
  CHUNK_REQUEST_TIMEOUT_MS,
  ChunkTranslationError,
  withRequestTimeout,
  type ChunkSentence,
} from './gemini-chunk-translation';

export const GROQ_MODEL = 'whisper-large-v3-turbo';
export const GROQ_ORIGIN = 'https://api.groq.com/*';
const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

// A segment Whisper itself thinks is probably not speech; its words are the
// stock phrases it invents over silence or music.
const MAX_NO_SPEECH_PROBABILITY = 0.6;

export const SENTENCE_END = /[.?!。！？…]["'』」)）”’\]}》〉】〕»]*$/u;
const LOWERCASE_START = /^\p{Ll}/u;
// Whisper sometimes returns fast, casual speech with no punctuation or
// capitals at all. Then pauses are the only sentence boundaries: a gap this
// long between words, once the sentence has run this long, ends it, and none
// runs past MAX_UNPUNCTUATED_SECONDS.
const UNPUNCTUATED_PAUSE_SECONDS = 0.6;
const MIN_UNPUNCTUATED_SECONDS = 1.5;
const MAX_UNPUNCTUATED_SECONDS = 8;
// Without capitals, a first sentence is taken as picked up mid-speech when it
// starts this close to the chunk's start.
const CHUNK_EDGE_SECONDS = 0.3;

export interface GroqWord {
  end: number;
  start: number;
  word: string;
}

// A Whisper segment, as Groq returns them.
export interface WhisperSegment {
  end: number;
  no_speech_prob?: number;
  start: number;
}

export interface TranscriptionRequest {
  apiKey: string;
  // Base64 WAV, 16 kHz mono PCM16.
  audioBase64: string;
  // Text Whisper continues from, to steer its style (Traditional Chinese).
  prompt?: string;
  // A Gemini language code, or undefined to let Whisper detect it.
  sourceLanguage?: string;
}

export interface RecognizedChunk {
  // BCP-47 base language Whisper heard, when it is one we know.
  language?: string;
  // Sentences with `translation` still empty.
  sentences: ChunkSentence[];
}

// Whisper names the language it detected in English ("English", "Chinese").
const WHISPER_LANGUAGES: Record<string, string> = {
  afrikaans: 'af', arabic: 'ar', armenian: 'hy', azerbaijani: 'az', basque: 'eu',
  belarusian: 'be', bengali: 'bn', bulgarian: 'bg', burmese: 'my', cantonese: 'zh',
  catalan: 'ca', chinese: 'zh', croatian: 'hr', czech: 'cs', danish: 'da',
  dutch: 'nl', english: 'en', estonian: 'et', finnish: 'fi', french: 'fr',
  galician: 'gl', georgian: 'ka', german: 'de', greek: 'el', gujarati: 'gu',
  hausa: 'ha', hebrew: 'he', hindi: 'hi', hungarian: 'hu', icelandic: 'is',
  indonesian: 'id', italian: 'it', japanese: 'ja', javanese: 'jv', kannada: 'kn',
  kazakh: 'kk', khmer: 'km', korean: 'ko', lao: 'lo', latvian: 'lv',
  lithuanian: 'lt', macedonian: 'mk', malay: 'ms', malayalam: 'ml', marathi: 'mr',
  mongolian: 'mn', nepali: 'ne', norwegian: 'nb', persian: 'fa', polish: 'pl',
  portuguese: 'pt', punjabi: 'pa', romanian: 'ro', russian: 'ru', serbian: 'sr',
  sindhi: 'sd', sinhala: 'si', slovak: 'sk', slovenian: 'sl', spanish: 'es',
  sundanese: 'su', swahili: 'sw', swedish: 'sv', tagalog: 'fil', tamil: 'ta',
  telugu: 'te', thai: 'th', turkish: 'tr', ukrainian: 'uk', urdu: 'ur',
  uzbek: 'uz', vietnamese: 'vi',
};

export function whisperLanguageCode(name: unknown): string | undefined {
  return typeof name === 'string' ? WHISPER_LANGUAGES[name.trim().toLowerCase()] : undefined;
}

// Joins words the way the language writes them: no space between two
// characters of a script written without spaces (Chinese, Japanese).
export function joinWords(words: string[]): string {
  let text = '';
  for (const word of words) {
    const piece = word.trim();
    if (!piece) continue;
    const previous = text.at(-1);
    const next = piece[0]!;
    text += !previous || (isWideCharacter(previous) && isWideCharacter(next))
      ? piece
      : ` ${piece}`;
  }
  return text;
}

// Times are seconds from the start of the chunk.
export function sentencesFromWords(words: GroqWord[]): ChunkSentence[] {
  const sentences: ChunkSentence[] = [];
  const unpunctuated = !words.some((word) => SENTENCE_END.test(word.word.trim()));
  // Capitals say where sentences start only if the text has any.
  const cased = words.some((word) => /\p{Lu}/u.test(word.word));
  let pending: GroqWord[] = [];
  const close = (finished: boolean) => {
    if (pending.length === 0) return;
    const original = joinWords(pending.map((word) => word.word));
    if (original) {
      const pickedUp = cased
        ? LOWERCASE_START.test(original)
        : pending[0]!.start < CHUNK_EDGE_SECONDS;
      sentences.push({
        // Cut at the chunk's end (no closing punctuation), or picked up
        // mid-sentence at its start (opens lowercase); the session decides
        // what to do with a cut fragment at a hard edge.
        cut: !finished || (sentences.length === 0 && pickedUp),
        end: Math.max(pending[0]!.start, pending.at(-1)!.end),
        original,
        sameLanguage: false,
        start: pending[0]!.start,
        translation: '',
      });
    }
    pending = [];
  };
  for (const word of words) {
    const last = pending.at(-1);
    if (unpunctuated && last) {
      const length = last.end - pending[0]!.start;
      const paused = word.start - last.end >= UNPUNCTUATED_PAUSE_SECONDS;
      if ((paused && length >= MIN_UNPUNCTUATED_SECONDS) || word.end - pending[0]!.start > MAX_UNPUNCTUATED_SECONDS) {
        close(true);
      }
    }
    pending.push(word);
    if (SENTENCE_END.test(word.word.trim())) close(true);
  }
  close(false);
  return sentences;
}

export function speechWords(words: GroqWord[], segments: WhisperSegment[]): GroqWord[] {
  const silent = segments.filter((segment) =>
    (segment.no_speech_prob ?? 0) > MAX_NO_SPEECH_PROBABILITY);
  return words.filter((word) =>
    !silent.some((segment) => word.start >= segment.start && word.start < segment.end));
}

export function isWord(value: unknown): value is GroqWord {
  const row = value as GroqWord | null;
  return Boolean(row) &&
    typeof row!.word === 'string' &&
    typeof row!.start === 'number' &&
    typeof row!.end === 'number';
}

async function errorForResponse(response: Response): Promise<ChunkTranslationError> {
  const { status } = response;
  if (status === 401 || status === 403) return new ChunkTranslationError('invalid_credentials', status);
  if (status === 429) {
    // Groq names the limit in the message: "... on requests per day (RPD)"
    // or "audio seconds per hour (ASH)".
    const message = await response.text().catch(() => '');
    return new ChunkTranslationError(
      /per day|\bRPD\b|\bASD\b/i.test(message) ? 'quota_exceeded' : 'rate_limited',
      status,
    );
  }
  return new ChunkTranslationError('provider_unavailable', status);
}

function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function requestTranscription(
  request: TranscriptionRequest,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<RecognizedChunk> {
  const form = new FormData();
  form.append('file', new Blob([decodeBase64(request.audioBase64)], { type: 'audio/wav' }), 'chunk.wav');
  form.append('model', GROQ_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  // Whisper takes ISO 639-1; 'zh-Hant' and 'pt-BR' become 'zh' and 'pt'.
  if (request.sourceLanguage) form.append('language', request.sourceLanguage.split('-')[0]!);
  if (request.prompt) form.append('prompt', request.prompt);
  let response: Response;
  try {
    response = await fetcher(ENDPOINT, {
      body: form,
      headers: { authorization: `Bearer ${request.apiKey}` },
      method: 'POST',
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ChunkTranslationError('network_error');
  }
  if (!response.ok) throw await errorForResponse(response);
  let body: { language?: unknown; segments?: unknown; words?: unknown };
  try {
    body = await response.json() as typeof body;
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ChunkTranslationError('invalid_response');
  }
  if (!Array.isArray(body.words)) throw new ChunkTranslationError('invalid_response');
  const segments = Array.isArray(body.segments) ? body.segments as WhisperSegment[] : [];
  const language = whisperLanguageCode(body.language);
  return {
    ...(language ? { language } : {}),
    sentences: sentencesFromWords(speechWords(body.words.filter(isWord), segments)),
  };
}

const globalFetch: typeof fetch = (input, init) => fetch(input, init);

export function transcribeChunk(
  request: TranscriptionRequest,
  fetcher: typeof fetch = globalFetch,
  timeoutMs = CHUNK_REQUEST_TIMEOUT_MS,
): Promise<RecognizedChunk> {
  return withRequestTimeout(
    (signal) => requestTranscription(request, fetcher, signal),
    timeoutMs,
  );
}
