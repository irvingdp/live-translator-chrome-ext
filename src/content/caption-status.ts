// How the caption overlay presents a session status (the status light, chosen
// from the caption-status prototype): a colour for what kind of status it is,
// a short label on the light, and the full message for the panel it opens.
import { t, type MessageKey } from '../core/i18n';

// wait: read-ahead holds the video (green, pulsing); info: a passing notice
// (blue); action: the viewer has to do something (amber); error: something
// failed (red). An urgent status opens the panel by itself once.
export type StatusTone = 'action' | 'error' | 'info' | 'wait';

export interface StatusPresentation {
  label: string;
  tone: StatusTone;
  // The viewer has to do something about it: the light opens its panel by
  // itself. An error that the next chunk usually clears (a rate limit, a slow
  // reply) only lights up.
  urgent: boolean;
}

// Errors that do not go away by themselves.
const URGENT_CODES = new Set([
  'gemini_disconnected',
  'read_ahead_translator_unsupported',
  'read_ahead_unsupported',
  'read_ahead_web_translation_failed',
]);
const URGENT_REASONS = new Set(['invalid_credentials', 'quota_exceeded']);

const WAIT_CODES = new Set(['read_ahead_captions_loading', 'read_ahead_loading', 'read_ahead_translating']);

// Codes whose label is a message of its own.
const LABELS: Record<string, { key: MessageKey; tone: StatusTone }> = {
  gemini_disconnected: { key: 'statusLabelDisconnected', tone: 'error' },
  read_ahead_captions_video: { key: 'noticeReadAheadCaptionsVideo', tone: 'info' },
  read_ahead_captions_video_no_highlight: { key: 'noticeReadAheadCaptionsVideo', tone: 'info' },
  read_ahead_captions_youtube: { key: 'noticeReadAheadCaptionsYouTube', tone: 'info' },
  read_ahead_captions_youtube_no_highlight: { key: 'noticeReadAheadCaptionsYouTube', tone: 'info' },
  read_ahead_failed: { key: 'statusLabelTranslationFailed', tone: 'error' },
  read_ahead_needs_site_access: { key: 'statusLabelSiteAccess', tone: 'action' },
  read_ahead_page_timeout: { key: 'statusLabelSkipped', tone: 'error' },
  read_ahead_translator_fallback: { key: 'statusLabelChromeTranslation', tone: 'info' },
  read_ahead_translator_quota_fallback: { key: 'statusLabelChromeTranslation', tone: 'info' },
  read_ahead_translator_unsupported: { key: 'statusLabelTranslationFailed', tone: 'error' },
  read_ahead_unsupported: { key: 'statusLabelUnsupported', tone: 'error' },
  read_ahead_web_translation_failed: { key: 'statusLabelTranslationFailed', tone: 'error' },
};

export const PROVIDER_NAMES: Record<string, string> = {
  gemini: 'Gemini',
  groq: 'Groq Whisper',
  local: '本地 Whisper',
};

// A provider's failure ('groq_rate_limited'), labelled with the service.
const REASON_LABELS: Record<string, MessageKey> = {
  invalid_credentials: 'statusLabelInvalidCredentials',
  invalid_response: 'statusLabelInvalidResponse',
  network_error: 'statusLabelNetworkError',
  provider_unavailable: 'statusLabelUnavailable',
  quota_exceeded: 'statusLabelQuota',
  rate_limited: 'statusLabelRateLimited',
  timeout: 'statusLabelTimeout',
  unavailable: 'statusLabelUnavailable',
};

export function statusPresentation(code: string, fullText: string): StatusPresentation {
  if (WAIT_CODES.has(code)) return { label: fullText, tone: 'wait', urgent: false };
  const own = LABELS[code];
  if (own) {
    return {
      label: t(own.key),
      tone: own.tone,
      urgent: own.tone === 'action' || URGENT_CODES.has(code),
    };
  }
  const [, provider, reason] = /^(gemini|groq|local)_(.+)$/.exec(code) ?? [];
  const reasonKey = reason ? REASON_LABELS[reason] : undefined;
  if (provider && reasonKey) {
    return {
      label: t(reasonKey, PROVIDER_NAMES[provider]!),
      tone: 'error',
      urgent: URGENT_REASONS.has(reason!),
    };
  }
  // Unknown: the message says to restart.
  return { label: t('statusLabelError'), tone: 'error', urgent: true };
}
