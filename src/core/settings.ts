import type { SessionSettings } from './capture-session-controller';

export interface AppSettings extends SessionSettings {
  originalFontSize: number;
  translationFontSize: number;
}

// maxLineWidth's floor of 40 is load-bearing: measurement showed the
// chunker's closed-unit boundaries are stable at widths 40-140 but not below
// ~30, so this range must not widen.
export const SETTING_RANGES = {
  backgroundOpacity: { max: 100, min: 0 },
  bottomOffset: { max: 60, min: 0 },
  captionRows: { max: 3, min: 1 },
  maxLineWidth: { max: 140, min: 40 },
  minLineWidth: { max: 120, min: 0 },
  originalFontSize: { max: 48, min: 16 },
  translationFontSize: { max: 48, min: 16 },
} as const;

export const DEFAULT_SETTINGS: AppSettings = {
  backgroundOpacity: 78,
  bottomOffset: 8,
  captionRows: 2,
  deepgramApiKey: '',
  deeplApiKey: '',
  maxLineWidth: 90,
  minLineWidth: 40,
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

function clamped(
  value: unknown,
  range: { max: number; min: number },
  fallback: number,
): number {
  const numeric =
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(numeric)));
}

export function normalizeSettings(raw: Partial<AppSettings>): AppSettings {
  const maxLineWidth = clamped(
    raw.maxLineWidth,
    SETTING_RANGES.maxLineWidth,
    DEFAULT_SETTINGS.maxLineWidth,
  );
  return {
    backgroundOpacity: clamped(
      raw.backgroundOpacity,
      SETTING_RANGES.backgroundOpacity,
      DEFAULT_SETTINGS.backgroundOpacity,
    ),
    bottomOffset: clamped(
      raw.bottomOffset,
      SETTING_RANGES.bottomOffset,
      DEFAULT_SETTINGS.bottomOffset,
    ),
    captionRows: clamped(
      raw.captionRows,
      SETTING_RANGES.captionRows,
      DEFAULT_SETTINGS.captionRows,
    ),
    deepgramApiKey: stringValue(
      raw.deepgramApiKey,
      DEFAULT_SETTINGS.deepgramApiKey,
    ),
    deeplApiKey: stringValue(raw.deeplApiKey, DEFAULT_SETTINGS.deeplApiKey),
    maxLineWidth,
    // A minimum above the maximum would ask the chunker to merge every unit
    // past the width it is allowed to reach, so the pair is clamped together
    // rather than each field independently.
    minLineWidth: Math.min(
      maxLineWidth,
      clamped(
        raw.minLineWidth,
        SETTING_RANGES.minLineWidth,
        DEFAULT_SETTINGS.minLineWidth,
      ),
    ),
    originalFontSize: clamped(
      raw.originalFontSize,
      SETTING_RANGES.originalFontSize,
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
    translationFontSize: clamped(
      raw.translationFontSize,
      SETTING_RANGES.translationFontSize,
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
