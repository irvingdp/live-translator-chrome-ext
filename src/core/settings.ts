import type { SessionSettings } from './capture-session-controller';

export interface AppSettings extends SessionSettings {
  originalFontSize: number;
  translationFontSize: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  deepgramApiKey: '',
  deeplApiKey: '',
  originalFontSize: 24,
  sourceLanguage: 'EN',
  sourceLocale: 'en-US',
  targetLanguage: 'ZH-HANT',
  translationFontSize: 22,
};

export const LANGUAGE_OPTIONS = [
  { deepgram: 'en-US', label: 'English', source: 'EN', target: 'EN-US' },
  { deepgram: 'zh-TW', label: '繁體中文', source: 'ZH', target: 'ZH-HANT' },
  { deepgram: 'ja', label: '日本語', source: 'JA', target: 'JA' },
  { deepgram: 'ko', label: '한국어', source: 'KO', target: 'KO' },
  { deepgram: 'de', label: 'Deutsch', source: 'DE', target: 'DE' },
  { deepgram: 'fr', label: 'Français', source: 'FR', target: 'FR' },
  { deepgram: 'es', label: 'Español', source: 'ES', target: 'ES' },
  { deepgram: 'pt-BR', label: 'Português', source: 'PT', target: 'PT-BR' },
  { deepgram: 'it', label: 'Italiano', source: 'IT', target: 'IT' },
  { deepgram: 'nl', label: 'Nederlands', source: 'NL', target: 'NL' },
] as const;

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function fontSize(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : fallback;
  return Math.min(48, Math.max(16, Math.round(numeric)));
}

export function normalizeSettings(raw: Partial<AppSettings>): AppSettings {
  return {
    deepgramApiKey: stringValue(
      raw.deepgramApiKey,
      DEFAULT_SETTINGS.deepgramApiKey,
    ),
    deeplApiKey: stringValue(raw.deeplApiKey, DEFAULT_SETTINGS.deeplApiKey),
    originalFontSize: fontSize(
      raw.originalFontSize,
      DEFAULT_SETTINGS.originalFontSize,
    ),
    sourceLanguage: stringValue(
      raw.sourceLanguage,
      DEFAULT_SETTINGS.sourceLanguage,
    ),
    sourceLocale: stringValue(raw.sourceLocale, DEFAULT_SETTINGS.sourceLocale),
    targetLanguage: stringValue(
      raw.targetLanguage,
      DEFAULT_SETTINGS.targetLanguage,
    ),
    translationFontSize: fontSize(
      raw.translationFontSize,
      DEFAULT_SETTINGS.translationFontSize,
    ),
  };
}

export function validateSettingsForStart(
  settings: AppSettings,
): Partial<Record<'deepgramApiKey' | 'deeplApiKey', string>> {
  const errors: Partial<
    Record<'deepgramApiKey' | 'deeplApiKey', string>
  > = {};
  if (!settings.deepgramApiKey.trim()) {
    errors.deepgramApiKey = '請輸入 Deepgram API Key';
  }
  if (!settings.deeplApiKey.trim()) {
    errors.deeplApiKey = '請輸入 DeepL API Key';
  }
  return errors;
}
