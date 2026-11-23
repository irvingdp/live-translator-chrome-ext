// What every read-ahead recognizer and translator shares: a chunk's sentences,
// the ways a request fails, deadlines, and the WAV a chunk is sent as. Gemini
// itself no longer recognizes read-ahead chunks (ADR 0012).
import { GEMINI_LANGUAGE_OPTIONS } from '../core/gemini-languages';

export const READ_AHEAD_SAMPLE_RATE = 16_000;

// A request that has not answered by then is given up. Requests are never
// retried: the viewer may be held while one runs, so the longest a chunk can
// hold the viewer is this, after which its stretch shows "翻譯失敗".
export const CHUNK_REQUEST_TIMEOUT_MS = 7_000;

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
  // Whisper's words with their times (seconds from the start of the chunk).
  words?: Array<{ end: number; start: number; text: string }>;
}

export function languageName(code: string): string {
  const option = GEMINI_LANGUAGE_OPTIONS.find((item) => item.code === code);
  return option ? `${option.label} (${code})` : code;
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
