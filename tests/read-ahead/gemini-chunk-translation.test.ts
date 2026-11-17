import { describe, expect, it, vi } from 'vitest';

import {
  CHUNK_REQUEST_TIMEOUT_MS,
  ChunkTranslationError,
  encodeWav,
  READ_AHEAD_MODEL,
  toBase64,
  translateChunk,
} from '../../src/read-ahead/gemini-chunk-translation';

function geminiReply(rows: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(rows) }] } }] }),
    { headers: { 'content-type': 'application/json' }, status },
  );
}

const request = { apiKey: 'secret', audioBase64: 'UklGRg==', targetLanguage: 'zh-Hant' };

describe('translateChunk', () => {
  it('sends the audio and a JSON schema to the fixed model, keeping the key out of the URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(geminiReply([]));
    await translateChunk({ ...request, sourceLanguage: 'en' }, fetcher);

    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain(`/models/${READ_AHEAD_MODEL}:generateContent`);
    expect(String(url)).not.toContain('secret');
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('secret');
    const body = JSON.parse(String(init?.body));
    expect(body.contents[0].parts[0]).toEqual({ inlineData: { data: 'UklGRg==', mimeType: 'audio/wav' } });
    const prompt = body.contents[0].parts[1].text as string;
    expect(prompt).toContain('繁體中文 (zh-Hant)');
    expect(prompt).toContain('The speech is in English (en).');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.items.required).toContain('sameLanguage');
  });

  it('leaves the source language to the model when none is set', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(geminiReply([]));
    await translateChunk(request, fetcher);
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(body.contents[0].parts[1].text).not.toContain('The speech is in');
  });

  it('returns the sentences, trimming text and dropping malformed rows', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(geminiReply([
      { cut: false, end: 2.5, original: ' Hello. ', sameLanguage: false, start: 0.4, translation: ' 你好。 ' },
      { end: 3, original: 'no start' },
      { cut: true, end: 1, original: 'x', sameLanguage: true, start: 2, translation: 'x' },
    ]));
    await expect(translateChunk(request, fetcher)).resolves.toEqual([
      { cut: false, end: 2.5, original: 'Hello.', sameLanguage: false, start: 0.4, translation: '你好。' },
      { cut: true, end: 2, original: 'x', sameLanguage: true, start: 2, translation: 'x' },
    ]);
  });

  it.each([
    [429, 'rate_limited'],
    [503, 'provider_unavailable'],
    [403, 'invalid_credentials'],
  ] as const)('maps HTTP %i to %s', async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status }));
    const error = await translateChunk(request, fetcher).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ChunkTranslationError);
    expect((error as ChunkTranslationError).code).toBe(code);
  });

  it('tells a used-up daily quota apart from a per-minute limit', async () => {
    const quota = (quotaId: string) => new Response(JSON.stringify({ error: { code: 429, details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId }] },
    ] } }), { status: 429 });
    await expect(translateChunk(request, vi.fn<typeof fetch>().mockResolvedValue(
      quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier'),
    ))).rejects.toMatchObject({ code: 'quota_exceeded' });
    await expect(translateChunk(request, vi.fn<typeof fetch>().mockResolvedValue(
      quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier'),
    ))).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('reports a network failure and an unparseable body distinctly', async () => {
    await expect(translateChunk(request, vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))))
      .rejects.toMatchObject({ code: 'network_error' });
    await expect(translateChunk(request, vi.fn<typeof fetch>().mockResolvedValue(new Response('{"candidates":[]}'))))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('gives up on a request that has not answered in time', async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const fetcher = vi.fn<typeof fetch>((_url, init) => {
        init?.signal?.addEventListener('abort', () => { aborted = true; });
        return new Promise<Response>(() => undefined);
      });
      const result = translateChunk(request, fetcher).catch((caught: unknown) => caught);
      await vi.advanceTimersByTimeAsync(CHUNK_REQUEST_TIMEOUT_MS);
      const error = await result;
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
