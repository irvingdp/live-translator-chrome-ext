import { describe, expect, it, vi } from 'vitest';

import type { ChunkSentence } from '../../src/read-ahead/gemini-chunk-translation';
import {
  CHROME_TRANSLATION_MS,
  GROQ_RATE_LIMIT_PAUSE_MS,
  GROQ_TRANSLATION_MS,
  PageTranslation,
  type PageTranslators,
} from '../../src/read-ahead/page-translation';

const sentence = (original: string): ChunkSentence => ({
  cut: false, end: 1, original, sameLanguage: false, start: 0, translation: '',
});
const languages = { sourceLanguage: 'en', targetLanguage: 'zh-Hant' };
const BUDGET = 8_500;

function translators(overrides: Partial<PageTranslators> = {}) {
  let clock = 0;
  const tag = (prefix: string) => (sentences: ChunkSentence[]) =>
    Promise.resolve(sentences.map((item) => ({ ...item, translation: `${prefix}:${item.original}` })));
  const all = {
    chrome: vi.fn<PageTranslators['chrome']>(tag('chrome')),
    groq: vi.fn<PageTranslators['groq']>((texts) => Promise.resolve(texts.map((text) => `groq:${text}`))),
    now: () => clock,
    web: vi.fn<PageTranslators['web']>(tag('web')),
    ...overrides,
  };
  return { advance: (ms: number) => { clock += ms; }, translators: all };
}

describe('PageTranslation', () => {
  it("uses Chrome's Translator when the viewer did not choose Groq (Qwen)", async () => {
    const { translators: t } = translators();
    const result = await new PageTranslation(t, 'chrome').translate([sentence('Hi.')], languages, 0, BUDGET);
    expect(result).toEqual({ sentences: [expect.objectContaining({ translation: 'chrome:Hi.' })], translator: 'chrome' });
    expect(t.groq).not.toHaveBeenCalled();
  });

  it('uses Groq (Qwen) when chosen, leaving Chrome its time after it', async () => {
    const { translators: t } = translators();
    const result = await new PageTranslation(t, 'groq').translate([sentence('Hi.')], languages, 0, BUDGET);
    expect(result).toEqual({ sentences: [expect.objectContaining({ translation: 'groq:Hi.' })], translator: 'groq' });
    expect(t.groq).toHaveBeenCalledWith(['Hi.'], languages, [], GROQ_TRANSLATION_MS);
    expect(t.chrome).not.toHaveBeenCalled();
  });

  it("gives Groq only what the chunk's budget leaves after Chrome's allowance", async () => {
    const { advance, translators: t } = translators();
    advance(2_000); // the recognizer took 2 s
    await new PageTranslation(t, 'groq').translate([sentence('Hi.')], languages, 0, BUDGET);
    expect(t.groq).toHaveBeenCalledWith(['Hi.'], languages, [], BUDGET - 2_000 - CHROME_TRANSLATION_MS);
  });

  it('sends the previous sentences as context, from either translator', async () => {
    const { translators: t } = translators();
    const groq = vi.mocked(t.groq);
    groq.mockRejectedValueOnce(new Error('timeout'));
    const page = new PageTranslation(t, 'groq');
    await page.translate([sentence('One.'), sentence('Two.'), sentence('Three.')], languages, 0, BUDGET);
    await page.translate([sentence('Four.')], languages, 0, BUDGET);
    expect(groq.mock.calls[1]![2]).toEqual([
      { original: 'Two.', translation: 'chrome:Two.' },
      { original: 'Three.', translation: 'chrome:Three.' },
    ]);
  });

  it.each(['timeout', 'provider_unavailable', 'invalid_response', 'network_error'])(
    "falls back to Chrome's Translator for a chunk Groq fails with %s, and tries Groq again next time",
    async (code) => {
      const { translators: t } = translators();
      vi.mocked(t.groq).mockRejectedValueOnce(new Error(code));
      const page = new PageTranslation(t, 'groq');
      await expect(page.translate([sentence('Hi.')], languages, 0, BUDGET)).resolves.toEqual({
        fallback: 'unavailable',
        fallbackReason: code,
        sentences: [expect.objectContaining({ translation: 'chrome:Hi.' })],
        translator: 'chrome',
      });
      await expect(page.translate([sentence('Hi.')], languages, 0, BUDGET))
        .resolves.toMatchObject({ translator: 'groq' });
    },
  );

  it('rests Groq for a while after a per-minute limit, then tries it again', async () => {
    const { advance, translators: t } = translators();
    vi.mocked(t.groq).mockRejectedValueOnce(new Error('rate_limited'));
    const page = new PageTranslation(t, 'groq');
    await expect(page.translate([sentence('Hi.')], languages, 0, BUDGET))
      .resolves.toMatchObject({ fallback: 'unavailable', fallbackReason: 'rate_limited', translator: 'chrome' });
    advance(GROQ_RATE_LIMIT_PAUSE_MS - 1_000);
    await expect(page.translate([sentence('Hi.')], languages, 19_000, BUDGET))
      .resolves.toMatchObject({ fallbackReason: 'rate_limit_pause', translator: 'chrome' });
    expect(t.groq).toHaveBeenCalledTimes(1);
    advance(1_000);
    await expect(page.translate([sentence('Hi.')], languages, 20_000, BUDGET))
      .resolves.toMatchObject({ translator: 'groq' });
  });

  it("skips Groq for the rest of the session once its daily quota is used up", async () => {
    const { translators: t } = translators();
    vi.mocked(t.groq).mockRejectedValueOnce(new Error('quota_exceeded'));
    const page = new PageTranslation(t, 'groq');
    await expect(page.translate([sentence('Hi.')], languages, 0, BUDGET))
      .resolves.toMatchObject({ fallback: 'quota', translator: 'chrome' });
    await expect(page.translate([sentence('Hi.')], languages, 0, BUDGET))
      .resolves.toMatchObject({ fallback: 'quota', translator: 'chrome' });
    expect(t.groq).toHaveBeenCalledTimes(1);
  });

  it('skips Groq when too little of the budget is left for it', async () => {
    const { advance, translators: t } = translators();
    advance(BUDGET - CHROME_TRANSLATION_MS - 500);
    await expect(new PageTranslation(t, 'groq').translate([sentence('Hi.')], languages, 0, BUDGET))
      .resolves.toMatchObject({ fallback: 'unavailable', translator: 'chrome' });
    expect(t.groq).not.toHaveBeenCalled();
  });

  it("goes on to Google's web translation where Chrome's Translator cannot", async () => {
    const { translators: t } = translators({
      chrome: vi.fn<PageTranslators['chrome']>().mockRejectedValue(new Error('translator_unsupported')),
    });
    vi.mocked(t.groq).mockRejectedValueOnce(new Error('timeout'));
    await expect(new PageTranslation(t, 'groq').translate([sentence('Hi.')], languages, 0, BUDGET)).resolves.toEqual({
      fallback: 'unavailable',
      fallbackReason: 'timeout',
      sentences: [expect.objectContaining({ translation: 'web:Hi.' })],
      translator: 'web',
    });
  });

  it("fails the chunk when Chrome's Translator fails for another reason", async () => {
    const { translators: t } = translators({
      chrome: vi.fn<PageTranslators['chrome']>().mockRejectedValue(new Error('boom')),
    });
    await expect(new PageTranslation(t, 'chrome').translate([sentence('Hi.')], languages, 0, BUDGET))
      .rejects.toThrow('boom');
    expect(t.web).not.toHaveBeenCalled();
  });
});
