import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  validateSettingsForStart,
} from '../../src/core/settings';

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

  it('defaults the layout settings to a visible caption box', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      backgroundOpacity: 78,
      bottomOffset: 8,
      maxLineWidth: 90,
    });
  });

  it('clamps the layout settings to their ranges', () => {
    expect(
      normalizeSettings({ backgroundOpacity: 150, bottomOffset: -5, maxLineWidth: 999 }),
    ).toMatchObject({
      backgroundOpacity: 100,
      bottomOffset: 0,
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
        bottomOffset: Number.POSITIVE_INFINITY,
        maxLineWidth: Number.NEGATIVE_INFINITY,
      }),
    ).toMatchObject({
      backgroundOpacity: DEFAULT_SETTINGS.backgroundOpacity,
      bottomOffset: DEFAULT_SETTINGS.bottomOffset,
      maxLineWidth: DEFAULT_SETTINGS.maxLineWidth,
    });
  });

  it('falls back to the default when a layout setting is not a number', () => {
    expect(
      normalizeSettings({
        backgroundOpacity: '90' as unknown as number,
        bottomOffset: null as unknown as number,
      }),
    ).toMatchObject({
      backgroundOpacity: DEFAULT_SETTINGS.backgroundOpacity,
      bottomOffset: DEFAULT_SETTINGS.bottomOffset,
    });
  });
});

describe('validateSettingsForStart', () => {
  it('reports both missing BYOK credentials next to their fields', () => {
    expect(validateSettingsForStart(DEFAULT_SETTINGS)).toEqual({
      deepgramApiKey: '請輸入 Deepgram API Key',
      deeplApiKey: '請輸入 DeepL API Key',
    });
  });

  it('returns no errors when both credentials are present', () => {
    expect(
      validateSettingsForStart({
        ...DEFAULT_SETTINGS,
        deepgramApiKey: 'dg',
        deeplApiKey: 'dl',
      }),
    ).toEqual({});
  });
});
