import { LOCAL_WHISPER_MODEL_IDS } from '../read-ahead/local-whisper';
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
  geminiApiKey: '',
  geminiSourceLanguage: 'auto',
  geminiTargetLanguage: 'zh-Hant',
  groqApiKey: '',
  localWhisperModel: 'turbo',
  maxLineWidth: 90,
  originalFontSize: 16,
  originalTextColor: '#ffffff',
  // Read-ahead: use the uploader's caption track when the video has one
  // (ADR 0007), and mark the original word by word (issue #18).
  preferCaptionTracks: true,
  // Without WebGPU; where the computer has it, the popup starts a viewer who
  // never chose on Local Whisper instead (initialRecognizer).
  readAheadRecognizer: 'groq',
  transcriber: 'gemini',
  translationFontSize: 16,
  translationTextColor: '#fde68a',
  wordHighlight: true,
};

// Deepgram was removed in 1.5.0 (issue #10); a stored 'deepgram' falls back to
// the default, Gemini live.
export const TRANSCRIBER_IDS = ['gemini', 'gemini-read-ahead'] as const;

export type TranscriberId = (typeof TRANSCRIBER_IDS)[number];

// Read-ahead mode picks its speech recognition (issue #11). Gemini also
// translates; with Groq Whisper or Local Whisper (issue #15) Chrome's
// built-in Translator translates.
// Cloudflare Whisper was removed before release (it often missed the 7 s
// budget); a stored 'cloudflare' falls back to the default.
export const READ_AHEAD_RECOGNIZERS = ['gemini', 'groq', 'local'] as const;
export type ReadAheadRecognizer = (typeof READ_AHEAD_RECOGNIZERS)[number];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
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
    localWhisperModel: oneOf(
      raw.localWhisperModel,
      LOCAL_WHISPER_MODEL_IDS,
      DEFAULT_SETTINGS.localWhisperModel,
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
    preferCaptionTracks: booleanValue(raw.preferCaptionTracks, DEFAULT_SETTINGS.preferCaptionTracks),
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
    wordHighlight: booleanValue(raw.wordHighlight, DEFAULT_SETTINGS.wordHighlight),
  };
}

export type ApiKeyField = 'geminiApiKey' | 'groqApiKey';

// The keys the chosen services need, in the order the popup asks for them.
export function requiredApiKeys(settings: AppSettings): ApiKeyField[] {
  if (settings.transcriber !== 'gemini-read-ahead' || settings.readAheadRecognizer === 'gemini') {
    return ['geminiApiKey'];
  }
  // Local Whisper needs no key, only its downloaded model.
  return settings.readAheadRecognizer === 'local' ? [] : ['groqApiKey'];
}

const MISSING_KEY_MESSAGES = {
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

// The recognizer for a viewer who has never chosen one: Local Whisper where
// this computer can run it, else Groq Whisper; both leave the translation to
// Chrome's built-in Translator. A stored choice is kept.
export function initialRecognizer(
  stored: Partial<AppSettings> | undefined,
  webGpu: boolean,
): ReadAheadRecognizer {
  const chosen = stored?.readAheadRecognizer;
  if (chosen && READ_AHEAD_RECOGNIZERS.includes(chosen)) return chosen;
  return webGpu ? 'local' : 'groq';
}

// Settings stored by a version before 1.5.0 may still select Deepgram, or hold
// its key and the fields only its mode used; a development build may hold
// Cloudflare's account ID and token, or select it. Normalizing drops them; the
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
    stored.readAheadRecognizer === 'cloudflare' ||
    Object.keys(stored).some((key) => !known.has(key));
  return {
    changed,
    needsGeminiKeyNotice: stored.transcriber === 'deepgram' && !settings.geminiApiKey.trim(),
    settings,
  };
}
