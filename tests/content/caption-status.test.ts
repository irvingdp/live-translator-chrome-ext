import { describe, expect, it } from 'vitest';

import { statusPresentation } from '../../src/content/caption-status';
import { sessionErrorText } from '../../src/content/caption-overlay';

const present = (code: string) => statusPresentation(code, sessionErrorText(code));

describe('statusPresentation', () => {
  it('labels a provider failure briefly, naming the service, as an error', () => {
    expect(present('gemini_rate_limited')).toMatchObject({ label: 'Gemini 限流中', tone: 'error' });
    expect(present('groq_quota_exceeded')).toMatchObject({ label: 'Groq Whisper 額度用完', tone: 'error' });
    expect(present('local_timeout')).toMatchObject({ label: '本地 Whisper 回應太慢', tone: 'error' });
    expect(present('gemini_invalid_credentials')).toMatchObject({ label: 'Gemini 金鑰無效', tone: 'error' });
  });

  it('marks only the errors that do not go away by themselves as urgent', () => {
    for (const code of ['gemini_rate_limited', 'groq_timeout', 'gemini_unavailable', 'groq_network_error',
      'gemini_invalid_response', 'read_ahead_page_timeout', 'read_ahead_failed']) {
      expect(present(code).urgent, code).toBe(false);
    }
    for (const code of ['gemini_quota_exceeded', 'groq_quota_exceeded', 'gemini_invalid_credentials',
      'read_ahead_needs_site_access', 'read_ahead_unsupported', 'read_ahead_web_translation_failed',
      'gemini_disconnected', 'something_else']) {
      expect(present(code).urgent, code).toBe(true);
    }
  });

  it('shows a hold as it is, waiting', () => {
    expect(present('read_ahead_loading')).toEqual({ label: '讀取音訊中…', tone: 'wait', urgent: false });
    expect(present('read_ahead_translating')).toEqual({ label: '翻譯中…', tone: 'wait', urgent: false });
  });

  it('shows a passing notice as information, and allowing the site as something to do', () => {
    expect(present('read_ahead_captions_youtube_no_highlight')).toEqual({ label: '使用 YouTube 字幕', tone: 'info', urgent: false });
    expect(present('read_ahead_translator_fallback')).toEqual({ label: '改用 Chrome 翻譯', tone: 'info', urgent: false });
    expect(present('read_ahead_needs_site_access')).toEqual({ label: '需要允許網站', tone: 'action', urgent: true });
  });

  it('falls back to a generic error label', () => {
    expect(present('something_else')).toMatchObject({ label: '發生錯誤', tone: 'error' });
  });
});
