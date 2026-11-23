import { describe, expect, it } from 'vitest';

import {
  captionAppearance,
  DEFAULT_SETTINGS,
  migrateStoredSettings,
  normalizeSettings,
  requiredApiKeys,
  validateSettingsForStart,
} from '../../src/core/settings';

describe('captionAppearance', () => {
  it('projects only visual settings and applies the Gemini row ceiling', () => {
    const settingsWithSecret = {
      ...DEFAULT_SETTINGS,
      geminiApiKey: 'must-not-leak',
      transcriber: 'gemini',
    } as const;
    const appearance = captionAppearance(settingsWithSecret);

    expect(appearance).toEqual({
      backgroundOpacity: 0,
      originalFontSize: 16,
      originalTextColor: '#ffffff',
      translationFontSize: 16,
      translationTextColor: '#fde68a',
    });
    expect(appearance).not.toHaveProperty('geminiApiKey');
  });
});

describe('normalizeSettings', () => {
  it('applies defaults and clamps both caption sizes to 12–36 px', () => {
    expect(
      normalizeSettings({ originalFontSize: 99, translationFontSize: 2 }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      originalFontSize: 36,
      translationFontSize: 12,
    });
  });

  it('preserves supported user settings', () => {
    expect(
      normalizeSettings({
        groqApiKey: 'gq',
        geminiTargetLanguage: 'ja',
        originalFontSize: 30,
        translationFontSize: 26,
      }),
    ).toMatchObject({
      groqApiKey: 'gq',
      geminiTargetLanguage: 'ja',
      originalFontSize: 30,
      translationFontSize: 26,
    });
  });

  it('normalizes valid text colors and defaults missing or invalid colors', () => {
    expect(normalizeSettings({
      originalTextColor: '#A1B2C3',
      translationTextColor: '#123abc',
    })).toMatchObject({
      originalTextColor: '#a1b2c3',
      translationTextColor: '#123abc',
    });
    expect(normalizeSettings({
      originalTextColor: '#fff',
      translationTextColor: 'yellow',
    })).toMatchObject({
      originalTextColor: DEFAULT_SETTINGS.originalTextColor,
      translationTextColor: DEFAULT_SETTINGS.translationTextColor,
    });
  });

  it('defaults the caption background to transparent', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      backgroundOpacity: 0,
      maxLineWidth: 90,
    });
  });

  it('clamps the layout settings to their ranges', () => {
    expect(
      normalizeSettings({ backgroundOpacity: 150, maxLineWidth: 999 }),
    ).toMatchObject({
      backgroundOpacity: 100,
      maxLineWidth: 140,
    });
  });

  it('rounds fractional layout settings', () => {
    expect(normalizeSettings({ maxLineWidth: 90.6 })).toMatchObject({
      maxLineWidth: 91,
    });
  });

  it('falls back to the default when a layout setting is NaN or Infinity', () => {
    expect(
      normalizeSettings({
        backgroundOpacity: Number.NaN,
        maxLineWidth: Number.NEGATIVE_INFINITY,
      }),
    ).toMatchObject({
      backgroundOpacity: DEFAULT_SETTINGS.backgroundOpacity,
      maxLineWidth: DEFAULT_SETTINGS.maxLineWidth,
    });
  });

  it('falls back to the default when a layout setting is not a number', () => {
    expect(
      normalizeSettings({
        backgroundOpacity: '90' as unknown as number,
      }),
    ).toMatchObject({
      backgroundOpacity: DEFAULT_SETTINGS.backgroundOpacity,
    });
  });
});

describe('normalizeSettings transcriber', () => {
  it('keeps a supported provider and rejects anything else', () => {
    expect(normalizeSettings({ transcriber: 'gemini' }).transcriber).toBe('gemini');
    // Deepgram was removed in 1.5.0.
    expect(normalizeSettings({ transcriber: 'deepgram' as never }).transcriber).toBe('gemini');
    // An unknown value would reach the offscreen dispatcher and start nothing.
    expect(
      normalizeSettings({ transcriber: 'whisper' as never }).transcriber,
    ).toBe(DEFAULT_SETTINGS.transcriber);
  });

  it('keeps read-ahead mode, and gives settings saved before it an auto-detected source', () => {
    expect(normalizeSettings({ transcriber: 'gemini-read-ahead' }).transcriber)
      .toBe('gemini-read-ahead');
    // Settings stored by an older version have no read-ahead source language.
    expect(normalizeSettings({ transcriber: 'gemini' }).geminiSourceLanguage).toBe('auto');
    expect(normalizeSettings({ geminiSourceLanguage: 'ja' }).geminiSourceLanguage).toBe('ja');
  });
});

describe('validateSettingsForStart', () => {
  it('asks live mode for the Gemini key, and read-ahead (Groq by default) for the Groq key', () => {
    expect(validateSettingsForStart(DEFAULT_SETTINGS)).toEqual({ geminiApiKey: '請輸入 Gemini API Key' });
    expect(validateSettingsForStart({ ...DEFAULT_SETTINGS, geminiApiKey: 'gm' })).toEqual({});
    const readAhead = { ...DEFAULT_SETTINGS, transcriber: 'gemini-read-ahead' } as const;
    expect(validateSettingsForStart(readAhead)).toEqual({ groqApiKey: '請輸入 Groq API Key' });
  });
});

describe('read-ahead services', () => {
  const readAhead = { ...DEFAULT_SETTINGS, transcriber: 'gemini-read-ahead' } as const;

  it('defaults to Groq Whisper, rejecting unknown and removed recognizers', () => {
    expect(normalizeSettings({}).readAheadRecognizer).toBe('groq');
    expect(normalizeSettings({ readAheadRecognizer: 'whisper' as never }).readAheadRecognizer).toBe('groq');
    // Gemini was removed (ADR 0012: often overloaded).
    expect(normalizeSettings({ readAheadRecognizer: 'gemini' as never }).readAheadRecognizer).toBe('groq');
    // Cloudflare Whisper was removed before release.
    expect(normalizeSettings({ readAheadRecognizer: 'cloudflare' as never }).readAheadRecognizer).toBe('groq');
  });


  it("asks for the keys of the recognizer chosen, and only those (Chrome's translation needs none)", () => {
    expect(requiredApiKeys({ ...readAhead, readAheadRecognizer: 'groq' })).toEqual(['groqApiKey']);
    // Gemini live ignores the read-ahead choice.
    expect(requiredApiKeys({ ...DEFAULT_SETTINGS, readAheadRecognizer: 'groq' })).toEqual(['geminiApiKey']);
    expect(validateSettingsForStart({ ...readAhead, readAheadRecognizer: 'groq' }))
      .toEqual({ groqApiKey: '請輸入 Groq API Key' });
  });

  it('asks for the Groq key when Groq (Qwen) translates, even with Local Whisper', () => {
    const readAhead = { ...DEFAULT_SETTINGS, transcriber: 'gemini-read-ahead' } as const;
    expect(requiredApiKeys({ ...readAhead, readAheadRecognizer: 'local', readAheadTranslator: 'chrome' })).toEqual([]);
    expect(requiredApiKeys({ ...readAhead, readAheadRecognizer: 'local', readAheadTranslator: 'groq' }))
      .toEqual(['groqApiKey']);
  });
});

describe('readAheadTranslator', () => {
  it('defaults to Groq (Qwen), also for stored settings without it or with an unknown one; a choice stays', () => {
    expect(DEFAULT_SETTINGS.readAheadTranslator).toBe('groq');
    expect(normalizeSettings({}).readAheadTranslator).toBe('groq');
    expect(normalizeSettings({ readAheadTranslator: 'deepl' as never }).readAheadTranslator).toBe('groq');
    expect(normalizeSettings({ readAheadTranslator: 'chrome' }).readAheadTranslator).toBe('chrome');
  });
});

describe('migrateStoredSettings', () => {
  // As a 1.4.x Deepgram user had them stored.
  const deepgramUser = {
    ...DEFAULT_SETTINGS,
    deepgramApiKey: 'dg-secret',
    minLineWidth: 40,
    sourceLanguage: 'EN',
    sourceLocale: 'en-US',
    targetLanguage: 'ZH-HANT',
    transcriber: 'deepgram',
  };

  it('moves a Deepgram user to Gemini live and drops Deepgram key and fields', () => {
    const result = migrateStoredSettings({ ...deepgramUser, groqApiKey: 'gq', originalFontSize: 30 });
    expect(result.changed).toBe(true);
    expect(result.settings).toEqual({
      ...DEFAULT_SETTINGS,
      groqApiKey: 'gq',
      originalFontSize: 30,
      transcriber: 'gemini',
    });
    expect(JSON.stringify(result.settings)).not.toContain('dg-secret');
  });

  it("drops Cloudflare's account ID and token, and a Cloudflare recognizer, from a development build", () => {
    const result = migrateStoredSettings({
      ...DEFAULT_SETTINGS,
      cloudflareAccountId: 'acc',
      cloudflareApiToken: 'cf-secret',
      groqApiKey: 'gq',
      readAheadRecognizer: 'cloudflare',
      transcriber: 'gemini-read-ahead',
    });
    expect(result.changed).toBe(true);
    expect(result.settings).toEqual({ ...DEFAULT_SETTINGS, groqApiKey: 'gq', transcriber: 'gemini-read-ahead' });
    expect(JSON.stringify(result.settings)).not.toContain('cf-secret');
    expect(result.needsGeminiKeyNotice).toBe(false);
  });

  it('asks for a Gemini key only when the moved user has none', () => {
    expect(migrateStoredSettings(deepgramUser).needsGeminiKeyNotice).toBe(true);
    expect(migrateStoredSettings({ ...deepgramUser, geminiApiKey: 'gm' }).needsGeminiKeyNotice)
      .toBe(false);
  });

  it('drops a leftover Deepgram key from a Gemini user without a notice', () => {
    const result = migrateStoredSettings({ ...DEFAULT_SETTINGS, deepgramApiKey: 'dg' });
    expect(result).toMatchObject({ changed: true, needsGeminiKeyNotice: false });
    expect(result.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('drops a DeepL key stored by 1.4.x (DeepL is no longer used)', () => {
    const result = migrateStoredSettings({ ...DEFAULT_SETTINGS, deeplApiKey: 'dl-secret' });
    expect(result).toMatchObject({ changed: true, needsGeminiKeyNotice: false });
    expect(JSON.stringify(result.settings)).not.toContain('dl-secret');
  });

  it('leaves settings that are already current alone', () => {
    expect(migrateStoredSettings({ ...DEFAULT_SETTINGS, transcriber: 'gemini-read-ahead' }))
      .toMatchObject({ changed: false, needsGeminiKeyNotice: false });
  });
});
