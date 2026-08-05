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
