import { describe, expect, it, vi } from 'vitest';

import { CHUNK_REQUEST_TIMEOUT_MS } from '../../src/read-ahead/gemini-chunk-translation';
import {
  CLOUDFLARE_MODEL,
  transcribeWithCloudflare,
} from '../../src/read-ahead/cloudflare-transcription';

const request = { accountId: 'acc123', apiToken: 'cf-token', audioBase64: 'UklGRg==' };

function reply(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ errors: [], result, success: true }), { status });
}

const word = (text: string, start: number, end: number) => ({ end, start, word: text });

describe('transcribeWithCloudflare', () => {
  it("runs the turbo Whisper model on the account's REST endpoint with base64 audio and the token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({
      segments: [{ end: 2, no_speech_prob: 0.01, start: 0, text: 'Hello there.', words: [word('Hello', 0, 0.5), word('there.', 0.5, 1)] }],
      text: 'Hello there.',
      transcription_info: { duration: 2, language: 'en' },
    }));

    const result = await transcribeWithCloudflare({ ...request, sourceLanguage: 'pt-BR' }, fetcher);

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/acc123/ai/run/${CLOUDFLARE_MODEL}`);
    expect(init!.headers).toEqual({ authorization: 'Bearer cf-token', 'content-type': 'application/json' });
    expect(JSON.parse(String(init!.body))).toEqual({
      audio: 'UklGRg==',
      language: 'pt',
      task: 'transcribe',
      vad_filter: true,
    });
    expect(result).toEqual({
      language: 'en',
      sentences: [expect.objectContaining({ end: 1, original: 'Hello there.', start: 0 })],
    });
  });

  it("takes the words from every segment, skipping a segment Whisper thinks is not speech", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({
      segments: [
        { end: 2, no_speech_prob: 0.02, start: 0, words: [word('One.', 0, 1)] },
        { end: 4, no_speech_prob: 0.95, start: 2, words: [word('Thanks.', 2.5, 3)] },
        { end: 6, no_speech_prob: 0.02, start: 4, words: [word('Two.', 4, 5)] },
      ],
      transcription_info: { language: 'english' },
    }));

    const { language, sentences } = await transcribeWithCloudflare(request, fetcher);

    expect(sentences.map((sentence) => sentence.original)).toEqual(['One.', 'Two.']);
    expect(language).toBe('en');
  });

  it.each([
    [401, '{"success":false}', 'invalid_credentials'],
    [429, '{"success":false,"errors":[{"code":3036,"message":"You have used up your daily free allocation of 10,000 neurons."}]}', 'quota_exceeded'],
    [429, '{"success":false,"errors":[{"message":"Too many requests"}]}', 'rate_limited'],
    [500, '{}', 'provider_unavailable'],
  ] as const)('maps HTTP %i to %s', async (status, body, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }));
    await expect(transcribeWithCloudflare(request, fetcher)).rejects.toMatchObject({ code });
  });

  it('rejects an envelope without a result, and gives up on a request that never answers', async () => {
    const failed = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"success":false,"result":null}', { status: 200 }));
    await expect(transcribeWithCloudflare(request, failed)).rejects.toMatchObject({ code: 'invalid_response' });

    vi.useFakeTimers();
    try {
      const hung = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
      const result = transcribeWithCloudflare(request, hung).catch((caught: unknown) => caught);
      await vi.advanceTimersByTimeAsync(CHUNK_REQUEST_TIMEOUT_MS);
      expect(await result).toMatchObject({ code: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });
});
