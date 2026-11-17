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
  cloudflareAccountId: '',
  cloudflareApiToken: '',
  geminiApiKey: '',
  geminiSourceLanguage: 'auto',
  geminiTargetLanguage: 'zh-Hant',
  groqApiKey: '',
  maxLineWidth: 90,
  originalFontSize: 16,
  originalTextColor: '#ffffff',
  readAheadRecognizer: 'gemini',
  transcriber: 'gemini',
  translationFontSize: 16,
  translationTextColor: '#fde68a',
};

// Deepgram was removed in 1.5.0 (issue #10); a stored 'deepgram' falls back to
// the default, Gemini live.
export const TRANSCRIBER_IDS = ['gemini', 'gemini-read-ahead'] as const;

export type TranscriberId = (typeof TRANSCRIBER_IDS)[number];

// Read-ahead mode picks its speech recognition (issue #11). Gemini also
// translates; with a Whisper service Chrome's built-in Translator translates.
export const READ_AHEAD_RECOGNIZERS = ['gemini', 'groq', 'cloudflare'] as const;
export type ReadAheadRecognizer = (typeof READ_AHEAD_RECOGNIZERS)[number];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

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
    cloudflareAccountId: stringValue(raw.cloudflareAccountId, DEFAULT_SETTINGS.cloudflareAccountId),
    cloudflareApiToken: stringValue(raw.cloudflareApiToken, DEFAULT_SETTINGS.cloudflareApiToken),
    geminiApiKey: stringValue(raw.geminiApiKey, DEFAULT_SETTINGS.geminiApiKey),
    geminiSourceLanguage: stringValue(
      raw.geminiSourceLanguage,
      DEFAULT_SETTINGS.geminiSourceLanguage,
    ),
    geminiTargetLanguage: stringValue(
      raw.geminiTargetLanguage,
      DEFAULT_SETTINGS.geminiTargetLanguage,
    ),
    groqApiKey: stringValue(raw.groqApiKey, DEFAULT_SETTINGS.groqApiKey),
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
    readAheadRecognizer: oneOf(
      raw.readAheadRecognizer,
      READ_AHEAD_RECOGNIZERS,
      DEFAULT_SETTINGS.readAheadRecognizer,
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

export type ApiKeyField =
  | 'cloudflareAccountId'
  | 'cloudflareApiToken'
  | 'geminiApiKey'
  | 'groqApiKey';

// The keys the chosen services need, in the order the popup asks for them.
export function requiredApiKeys(settings: AppSettings): ApiKeyField[] {
  if (settings.transcriber !== 'gemini-read-ahead' || settings.readAheadRecognizer === 'gemini') {
    return ['geminiApiKey'];
  }
  return settings.readAheadRecognizer === 'cloudflare'
    ? ['cloudflareAccountId', 'cloudflareApiToken']
    : ['groqApiKey'];
}

const MISSING_KEY_MESSAGES = {
  cloudflareAccountId: 'needCloudflareAccountIdField',
  cloudflareApiToken: 'needCloudflareTokenField',
  geminiApiKey: 'needGeminiKeyField',
  groqApiKey: 'needGroqKeyField',
} as const;

export function validateSettingsForStart(
  settings: AppSettings,
): Partial<Record<ApiKeyField, string>> {
  const errors: Partial<Record<ApiKeyField, string>> = {};
  for (const field of requiredApiKeys(settings)) {
    if (!settings[field].trim()) errors[field] = t(MISSING_KEY_MESSAGES[field]);
  }
  return errors;
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
