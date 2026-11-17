import { describe, expect, it, vi } from 'vitest';

import {
  ChromeTranslation,
  chromeLanguageCode,
  type LanguageDetectorApi,
  type TranslatorApi,
} from '../../src/read-ahead/chrome-translation';
import type { ChunkSentence } from '../../src/read-ahead/gemini-chunk-translation';

const sentence = (original: string): ChunkSentence => ({
  cut: false,
  end: 1,
  original,
  sameLanguage: false,
  start: 0,
  translation: '',
});

function translatorApi(availability: Awaited<ReturnType<TranslatorApi['availability']>> = 'available') {
  const translate = vi.fn(async (text: string) => `譯:${text}`);
  const api: TranslatorApi = {
    availability: vi.fn().mockResolvedValue(availability),
    create: vi.fn().mockResolvedValue({ translate }),
  };
  return { api, translate };
}

describe('ChromeTranslation', () => {
  it('translates each sentence with one translator per language pair', async () => {
    const { api, translate } = translatorApi();
    const translation = new ChromeTranslation(api, undefined);

    const first = await translation.translate([sentence('One.'), sentence('Two.')], {
      sourceLanguage: 'en',
      targetLanguage: 'zh-Hant',
    });
    await translation.translate([sentence('Three.')], { sourceLanguage: 'en', targetLanguage: 'zh-Hant' });

    expect(first.map((item) => item.translation)).toEqual(['譯:One.', '譯:Two.']);
    expect(api.create).toHaveBeenCalledOnce();
    expect(api.create).toHaveBeenCalledWith({ sourceLanguage: 'en', targetLanguage: 'zh-Hant' });
    expect(translate).toHaveBeenCalledTimes(3);
  });

  it('detects the source language when Whisper did not name one', async () => {
    const { api } = translatorApi();
    const detector: LanguageDetectorApi = {
      create: vi.fn().mockResolvedValue({
        detect: vi.fn().mockResolvedValue([{ confidence: 0.9, detectedLanguage: 'ja' }]),
      }),
    };
    await new ChromeTranslation(api, detector).translate([sentence('こんにちは。')], {
      targetLanguage: 'en',
    });
    expect(api.create).toHaveBeenCalledWith({ sourceLanguage: 'ja', targetLanguage: 'en' });
  });

  it('leaves speech already in the target language untranslated', async () => {
    const { api } = translatorApi();
    const [result] = await new ChromeTranslation(api, undefined)
      .translate([sentence('你好。')], { sourceLanguage: 'zh', targetLanguage: 'zh-Hant' });
    expect(result).toMatchObject({ sameLanguage: true, translation: '' });
    expect(api.create).not.toHaveBeenCalled();
  });

  it('reports a browser without the API, an unsupported pair, or a pack it cannot download here', async () => {
    const options = { sourceLanguage: 'en', targetLanguage: 'zu' };
    await expect(new ChromeTranslation(undefined, undefined).translate([sentence('Hi.')], options))
      .rejects.toThrow('translator_unsupported');
    await expect(new ChromeTranslation(translatorApi('unavailable').api, undefined)
      .translate([sentence('Hi.')], options)).rejects.toThrow('translator_unsupported');

    const { api } = translatorApi('downloadable');
    vi.mocked(api.create).mockRejectedValueOnce(new DOMException('needs a gesture', 'NotAllowedError'));
    const translation = new ChromeTranslation(api, undefined);
    await expect(translation.translate([sentence('Hi.')], options)).rejects.toThrow('translator_unsupported');
    // Tried again on the next chunk: the popup may have downloaded it meanwhile.
    await expect(translation.translate([sentence('Hi.')], options)).resolves.toHaveLength(1);
  });

  it("uses Chrome's codes where they differ from Gemini's", () => {
    expect(chromeLanguageCode('zh-Hans')).toBe('zh');
    expect(chromeLanguageCode('pt-BR')).toBe('pt');
    expect(chromeLanguageCode('zh-Hant')).toBe('zh-Hant');
    expect(chromeLanguageCode('zh-HK')).toBe('zh-Hant');
  });
});
