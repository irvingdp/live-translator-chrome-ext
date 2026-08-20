import { describe, expect, it } from 'vitest';

import {
  captionAppearance,
  DEFAULT_SETTINGS,
  normalizeSettings,
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
      backgroundOpacity: 50,
      originalFontSize: 24,
      originalTextColor: '#ffffff',
      translationFontSize: 22,
      translationTextColor: '#fde68a',
    });
    expect(appearance).not.toHaveProperty('geminiApiKey');
  });
});

describe('normalizeSettings', () => {
  it('applies defaults and clamps both caption sizes to 16–48 px', () => {
    expect(
      normalizeSettings({ originalFontSize: 99, translationFontSize: 2 }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      originalFontSize: 48,
      translationFontSize: 16,
    });
  });

  it('preserves supported user settings', () => {
    expect(
      normalizeSettings({
        deepgramApiKey: 'dg',
        deeplApiKey: 'dl',
        originalFontSize: 30,
        sourceLanguage: 'JA',
        sourceLocale: 'ja',
        targetLanguage: 'EN-US',
        translationFontSize: 26,
      }),
    ).toMatchObject({
      deepgramApiKey: 'dg',
      deeplApiKey: 'dl',
      originalFontSize: 30,
      sourceLanguage: 'JA',
      sourceLocale: 'ja',
      targetLanguage: 'EN-US',
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

  it('defaults the layout settings to a visible caption box', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      backgroundOpacity: 50,
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
    expect(normalizeSettings({ transcriber: 'deepgram' }).transcriber).toBe(
      'deepgram',
    );
    // An unknown value would reach the offscreen dispatcher and start nothing.
    expect(
      normalizeSettings({ transcriber: 'whisper' as never }).transcriber,
    ).toBe(DEFAULT_SETTINGS.transcriber);
  });
});

describe('validateSettingsForStart', () => {
  const deepgramDefaults = {
    ...DEFAULT_SETTINGS,
    transcriber: 'deepgram',
  } as const;

  it('reports both missing BYOK credentials next to their fields', () => {
    expect(validateSettingsForStart(deepgramDefaults)).toEqual({
      deepgramApiKey: '請輸入 Deepgram API Key',
      deeplApiKey: '請輸入 DeepL API Key',
    });
  });

  it('returns no errors when both credentials are present', () => {
    expect(
      validateSettingsForStart({
        ...deepgramDefaults,
        deepgramApiKey: 'dg',
        deeplApiKey: 'dl',
      }),
    ).toEqual({});
  });

  // The Gemini path replaces both other providers, so asking for their keys
  // would block a session that has everything it needs.
  it('asks only for the Gemini key when Gemini does both jobs', () => {
    expect(
      validateSettingsForStart({ ...DEFAULT_SETTINGS, transcriber: 'gemini' }),
    ).toEqual({ geminiApiKey: '請輸入 Gemini API Key' });
    expect(
      validateSettingsForStart({
        ...DEFAULT_SETTINGS,
        geminiApiKey: 'gm',
        transcriber: 'gemini',
      }),
    ).toEqual({});
  });
});
