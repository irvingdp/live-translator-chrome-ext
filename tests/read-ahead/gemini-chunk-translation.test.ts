import { describe, expect, it, vi } from 'vitest';

import {
  CHUNK_REQUEST_TIMEOUT_MS,
  ChunkTranslationError,
  encodeWav,
  toBase64,
  withDeadline,
  withRequestTimeout,
} from '../../src/read-ahead/gemini-chunk-translation';

describe('withRequestTimeout', () => {
  it('aborts and gives up on a request that has not answered in time', async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const result = withRequestTimeout((signal) => {
        signal.addEventListener('abort', () => { aborted = true; });
        return new Promise<never>(() => undefined);
      }, CHUNK_REQUEST_TIMEOUT_MS).catch((caught: unknown) => caught);
      await vi.advanceTimersByTimeAsync(CHUNK_REQUEST_TIMEOUT_MS);
      const error = await result;
      expect(error).toBeInstanceOf(ChunkTranslationError);
      expect(error).toMatchObject({ code: 'timeout' });
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('encodeWav', () => {
  it('writes a 16 kHz mono PCM16 header followed by little-endian samples', () => {
    const wav = encodeWav(Int16Array.from([1, -2]));
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(4);
    expect(view.getInt16(44, true)).toBe(1);
    expect(view.getInt16(46, true)).toBe(-2);
    expect(toBase64(wav.subarray(0, 4))).toBe('UklGRg==');
  });
});

describe('withDeadline', () => {
  it('rejects with the given code when a step never settles, and passes a settled one through', async () => {
    vi.useFakeTimers();
    try {
      const hung = withDeadline(new Promise(() => undefined), 1_000, 'translator_timeout')
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await hung).toMatchObject({ message: 'translator_timeout' });
      await expect(withDeadline(Promise.resolve('ok'), 1_000, 'x')).resolves.toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });
});
