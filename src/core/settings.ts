import type { SessionSettings } from './capture-session-controller';
import { t } from './i18n';

export interface AppSettings extends SessionSettings {
  originalFontSize: number;
  originalTextColor: string;
  translationFontSize: number;
  translationTextColor: string;
}

export interface CaptionAppearance {
  backgroundOpacity: number;
  originalFontSize: number;
  originalTextColor: string;
  translationFontSize: number;
  translationTextColor: string;
}

export function captionAppearance(
  settings: Pick<
    SessionSettings,
    | 'backgroundOpacity'
    | 'originalFontSize'
    | 'originalTextColor'
    | 'translationFontSize'
    | 'translationTextColor'
  >,
): CaptionAppearance {
  return {
    backgroundOpacity: settings.backgroundOpacity,
    originalFontSize: settings.originalFontSize,
    originalTextColor: settings.originalTextColor,
    translationFontSize: settings.translationFontSize,
    translationTextColor: settings.translationTextColor,
  };
}

// maxLineWidth's floor of 40 is load-bearing: measurement showed the
// chunker's closed-unit boundaries are stable at widths 40-140 but not below
// ~30, so this range must not widen.
export const SETTING_RANGES = {
  backgroundOpacity: { max: 100, min: 0 },
  maxLineWidth: { max: 140, min: 40 },
  minLineWidth: { max: 120, min: 0 },
  originalFontSize: { max: 36, min: 12 },
  translationFontSize: { max: 36, min: 12 },
} as const;

export const DEFAULT_SETTINGS: AppSettings = {
  backgroundOpacity: 0,
  deepgramApiKey: '',
  deeplApiKey: '',
  geminiApiKey: '',
  geminiTargetLanguage: 'zh-Hant',
  maxLineWidth: 90,
  minLineWidth: 40,
  originalFontSize: 16,
  originalTextColor: '#ffffff',
  sourceLanguage: 'EN',
  sourceLocale: 'en-US',
  targetLanguage: 'ZH-HANT',
  transcriber: 'gemini',
  translationFontSize: 16,
  translationTextColor: '#fde68a',
};

export const TRANSCRIBER_IDS = ['deepgram', 'gemini'] as const;

export type TranscriberId = (typeof TRANSCRIBER_IDS)[number];

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

function colorValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback;
}

// The only setting whose value changes which provider runs, so an unknown
// string has to fall back rather than reach the offscreen dispatcher.
function transcriberValue(value: unknown): TranscriberId {
  return TRANSCRIBER_IDS.includes(value as TranscriberId)
    ? (value as TranscriberId)
    : DEFAULT_SETTINGS.transcriber;
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
    deepgramApiKey: stringValue(
      raw.deepgramApiKey,
      DEFAULT_SETTINGS.deepgramApiKey,
    ),
    deeplApiKey: stringValue(raw.deeplApiKey, DEFAULT_SETTINGS.deeplApiKey),
    geminiApiKey: stringValue(raw.geminiApiKey, DEFAULT_SETTINGS.geminiApiKey),
    geminiTargetLanguage: stringValue(
      raw.geminiTargetLanguage,
      DEFAULT_SETTINGS.geminiTargetLanguage,
    ),
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
    originalTextColor: colorValue(
      raw.originalTextColor,
      DEFAULT_SETTINGS.originalTextColor,
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
    transcriber: transcriberValue(raw.transcriber),
    translationFontSize: clamped(
      raw.translationFontSize,
      SETTING_RANGES.translationFontSize,
      DEFAULT_SETTINGS.translationFontSize,
    ),
    translationTextColor: colorValue(
      raw.translationTextColor,
      DEFAULT_SETTINGS.translationTextColor,
    ),
  };
}

type ApiKeyField = 'deepgramApiKey' | 'deeplApiKey' | 'geminiApiKey';

// Gemini Live Translate transcribes and translates in one session, so its
// mode needs neither of the other two keys.
export function validateSettingsForStart(
  settings: AppSettings,
): Partial<Record<ApiKeyField, string>> {
  const errors: Partial<Record<ApiKeyField, string>> = {};
  if (settings.transcriber === 'gemini') {
    if (!settings.geminiApiKey.trim()) {
      errors.geminiApiKey = t('needGeminiKeyField');
    }
    return errors;
  }
  if (!settings.deepgramApiKey.trim()) {
    errors.deepgramApiKey = t('needDeepgramKeyField');
  }
  if (!settings.deeplApiKey.trim()) {
    errors.deeplApiKey = t('needDeeplKeyField');
  }
  return errors;
}
