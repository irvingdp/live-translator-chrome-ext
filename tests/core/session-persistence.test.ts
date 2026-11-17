import { describe, expect, it } from 'vitest';

import { redactSessionSnapshot } from '../../src/core/session-persistence';
import type { ActiveSessionSnapshot } from '../../src/core/capture-session-controller';

describe('session persistence', () => {
  it('never copies API credentials into chrome.storage.session', () => {
    const snapshot: ActiveSessionSnapshot = {
      sessionId: 'session-1',
      tabId: 42,
      settings: {
        backgroundOpacity: 78,
        geminiApiKey: 'gemini-secret',
        geminiSourceLanguage: 'auto',
        geminiTargetLanguage: 'zh-Hant',
        groqApiKey: 'groq-secret',
        maxLineWidth: 90,
        readAheadRecognizer: 'gemini',
        originalFontSize: 24,
        originalTextColor: '#ffffff',
        transcriber: 'gemini',
        translationFontSize: 22,
        translationTextColor: '#fde68a',
      },
    };

    const persisted = redactSessionSnapshot(snapshot);

    expect(JSON.stringify(persisted)).not.toContain('secret');
    expect(persisted).toEqual({
      sessionId: 'session-1',
      tabId: 42,
      settings: {
        backgroundOpacity: 78,
        geminiSourceLanguage: 'auto',
        geminiTargetLanguage: 'zh-Hant',
        maxLineWidth: 90,
        originalFontSize: 24,
        originalTextColor: '#ffffff',
        readAheadRecognizer: 'gemini',
        transcriber: 'gemini',
        translationFontSize: 22,
        translationTextColor: '#fde68a',
      },
    });
  });
});
