import { describe, expect, it, vi } from 'vitest';

import { googleLanguageCode, translateOnWeb } from '../../src/read-ahead/web-translation';

const request = { sourceLanguage: 'en', targetLanguage: 'zh-Hant', texts: ['One.', 'Two.'] };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function googleFetcher(google: (url: URL) => Response) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.host === 'translate.googleapis.com') return google(url);
    throw new Error(`unexpected ${url}`);
  });
}

describe('translateOnWeb', () => {
  it("uses Google's endpoint, one sentence per request", async () => {
    const fetcher = googleFetcher((url) => json([[[`譯${url.searchParams.get('q')}`, url.searchParams.get('q')]]]));

    await expect(translateOnWeb(request, undefined, fetcher)).resolves.toEqual(['譯One.', '譯Two.']);

    const urls = fetcher.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls).toHaveLength(2);
    expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({
      client: 'gtx', dt: 't', q: 'One.', sl: 'en', tl: 'zh-TW',
    });
  });

  it("joins Google's pieces of a long translation, and lets it detect an unknown source", async () => {
    const fetcher = googleFetcher(() => json([[['第一句，', 'First,'], ['第二句。', 'second.']]]));
    await expect(translateOnWeb({ targetLanguage: 'zh-Hant', texts: ['First, second.'] }, undefined, fetcher))
      .resolves.toEqual(['第一句，第二句。']);
    expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.get('sl')).toBe('auto');
  });

  it('fails when Google fails or answers nothing, and sends nothing for no sentences', async () => {
    await expect(translateOnWeb(request, undefined, googleFetcher(() => new Response('', { status: 429 }))))
      .rejects.toMatchObject({ code: 'provider_unavailable' });
    await expect(translateOnWeb(request, undefined, googleFetcher(() => json([[]]))))
      .rejects.toMatchObject({ code: 'invalid_response' });
    const fetcher = googleFetcher(() => json([[]]));
    await expect(translateOnWeb({ ...request, texts: [] }, undefined, fetcher)).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses Google's codes where they differ from Gemini's", () => {
    expect(googleLanguageCode('zh-Hant')).toBe('zh-TW');
    expect(googleLanguageCode('he')).toBe('iw');
    expect(googleLanguageCode('ja')).toBe('ja');
  });
});
