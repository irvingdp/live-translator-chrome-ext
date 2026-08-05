import { describe, expect, it, vi } from 'vitest';

import {
  DeepLClient,
  ProviderError,
  resolveDeepLEndpoint,
} from '../../src/providers/deepl';

describe('resolveDeepLEndpoint', () => {
  it('uses the Free endpoint for keys ending in :fx', () => {
    expect(resolveDeepLEndpoint('example:fx')).toBe(
      'https://api-free.deepl.com/v2/translate',
    );
  });

  it('uses the Pro endpoint for all other keys', () => {
    expect(resolveDeepLEndpoint('example-pro-key')).toBe(
      'https://api.deepl.com/v2/translate',
    );
  });
});

describe('DeepLClient', () => {
  it('posts a compatible translation request without exposing the key in the URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          translations: [
            { detected_source_language: 'EN', text: '早安' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new DeepLClient(fetcher);

    await expect(
      client.translate({
        apiKey: 'secret:fx',
        sourceLanguage: 'EN',
        targetLanguage: 'ZH-HANT',
        text: 'Good morning',
      }),
    ).resolves.toEqual({ detectedSourceLanguage: 'EN', text: '早安' });

    const [url, request] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api-free.deepl.com/v2/translate');
    expect(String(url)).not.toContain('secret');
    expect(request?.method).toBe('POST');
    expect(new Headers(request?.headers).get('Authorization')).toBe(
      'DeepL-Auth-Key secret:fx',
    );
    expect(JSON.parse(String(request?.body))).toEqual({
      source_lang: 'EN',
      target_lang: 'ZH-HANT',
      text: ['Good morning'],
    });
  });

  it('calls the global fetch without rebinding it to the client', async () => {
    // Chrome rejects `fetch` invoked with a non-global `this`
    // ("Illegal invocation"), so the default fetcher must not be called as a
    // method of DeepLClient. Node's fetch is not this-sensitive, so assert the
    // receiver directly.
    const receivers: unknown[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = function (this: unknown) {
      receivers.push(this);
      return Promise.resolve(
        new Response(JSON.stringify({ translations: [{ text: '早安' }] }), {
          status: 200,
        }),
      );
    } as unknown as typeof fetch;

    const client = new DeepLClient();
    try {
      await client.translate({
        apiKey: 'secret:fx',
        sourceLanguage: 'EN',
        targetLanguage: 'ZH-HANT',
        text: 'Good morning',
      });
    } finally {
      globalThis.fetch = original;
    }

    expect(receivers).toHaveLength(1);
    expect(receivers[0]).not.toBe(client);
    expect(receivers[0]).not.toBeInstanceOf(DeepLClient);
  });

  it.each([
    [403, 'invalid_credentials'],
    [429, 'rate_limited'],
    [456, 'quota_exceeded'],
    [500, 'provider_unavailable'],
  ] as const)('maps HTTP %i to %s', async (status, code) => {
    const client = new DeepLClient(
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status })),
    );

    const error = await client
      .translate({
        apiKey: 'secret',
        sourceLanguage: 'EN',
        targetLanguage: 'DE',
        text: 'Hello',
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code, status });
  });

  it('normalizes a fetch-level network failure', async () => {
    const client = new DeepLClient(
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    const error = await client.translate({
      apiKey: 'secret:fx',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH-HANT',
      text: 'Hello',
    }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'network_error' });
  });

  it('preserves an aborted fetch so cancellation is not retried', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    const client = new DeepLClient(
      vi.fn<typeof fetch>().mockRejectedValue(abort),
    );

    await expect(client.translate({
      apiKey: 'secret:fx',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH-HANT',
      text: 'Hello',
    })).rejects.toBe(abort);
  });

  it('forwards an AbortSignal so stale segment requests can be cancelled', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async (_url, request) => {
        expect(request?.signal?.aborted).toBe(false);
        return new Response(
          JSON.stringify({ translations: [{ text: 'Hallo' }] }),
          { status: 200 },
        );
      },
    );
    const controller = new AbortController();

    await new DeepLClient(fetcher).translate(
      {
        apiKey: 'secret',
        sourceLanguage: 'EN',
        targetLanguage: 'DE',
        text: 'Hello',
      },
      controller.signal,
    );

    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    new Response('not-json', { status: 200 }),
    new Response(JSON.stringify({ translations: [{ text: 42 }] }), {
      status: 200,
    }),
  ])('normalizes malformed successful responses', async (response) => {
    const client = new DeepLClient(
      vi.fn<typeof fetch>().mockResolvedValue(response),
    );

    const error = await client
      .translate({
        apiKey: 'secret',
        sourceLanguage: 'EN',
        targetLanguage: 'DE',
        text: 'Hello',
      })
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'invalid_response' });
  });
});
