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

export const SETTING_RANGES = {
  backgroundOpacity: { max: 100, min: 0 },
  maxLineWidth: { max: 140, min: 40 },
  originalFontSize: { max: 36, min: 12 },
  translationFontSize: { max: 36, min: 12 },
} as const;

export const DEFAULT_SETTINGS: AppSettings = {
  backgroundOpacity: 0,
  deeplApiKey: '',
  geminiApiKey: '',
  geminiSourceLanguage: 'auto',
  geminiTargetLanguage: 'zh-Hant',
  maxLineWidth: 90,
  originalFontSize: 16,
  originalTextColor: '#ffffff',
  transcriber: 'gemini',
  translationFontSize: 16,
  translationTextColor: '#fde68a',
};

// Deepgram was removed in 1.5.0 (issue #10); a stored 'deepgram' falls back to
// the default, Gemini live.
export const TRANSCRIBER_IDS = ['gemini', 'gemini-read-ahead'] as const;

export type TranscriberId = (typeof TRANSCRIBER_IDS)[number];

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
  return {
    backgroundOpacity: clamped(
      raw.backgroundOpacity,
      SETTING_RANGES.backgroundOpacity,
      DEFAULT_SETTINGS.backgroundOpacity,
    ),
    deeplApiKey: stringValue(raw.deeplApiKey, DEFAULT_SETTINGS.deeplApiKey),
    geminiApiKey: stringValue(raw.geminiApiKey, DEFAULT_SETTINGS.geminiApiKey),
    geminiSourceLanguage: stringValue(
      raw.geminiSourceLanguage,
      DEFAULT_SETTINGS.geminiSourceLanguage,
    ),
    geminiTargetLanguage: stringValue(
      raw.geminiTargetLanguage,
      DEFAULT_SETTINGS.geminiTargetLanguage,
    ),
    maxLineWidth: clamped(
      raw.maxLineWidth,
      SETTING_RANGES.maxLineWidth,
      DEFAULT_SETTINGS.maxLineWidth,
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

// Both modes run on Gemini, so the Gemini key is the only one a start needs.
export function validateSettingsForStart(
  settings: AppSettings,
): Partial<Record<'geminiApiKey', string>> {
  return settings.geminiApiKey.trim()
    ? {}
    : { geminiApiKey: t('needGeminiKeyField') };
}

// Storage key of the one-time popup notice set by migrateStoredSettings.
export const DEEPGRAM_REMOVED_NOTICE_KEY = 'deepgramRemovedNotice';

// Settings stored by a version before 1.5.0 may still select Deepgram, or hold
// its key and the fields only its mode used. Normalizing drops them; the
// result says whether the stored copy needs rewriting, and whether a Deepgram
// user was moved to Gemini live without a Gemini key (the popup then tells
// them why it is asking for one).
export function migrateStoredSettings(raw: unknown): {
  changed: boolean;
  needsGeminiKeyNotice: boolean;
  settings: AppSettings;
} {
  const stored = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const settings = normalizeSettings(stored as Partial<AppSettings>);
  const known = new Set(Object.keys(DEFAULT_SETTINGS));
  const changed = stored.transcriber === 'deepgram' ||
    Object.keys(stored).some((key) => !known.has(key));
  return {
    changed,
    needsGeminiKeyNotice: stored.transcriber === 'deepgram' && !settings.geminiApiKey.trim(),
    settings,
  };
}
