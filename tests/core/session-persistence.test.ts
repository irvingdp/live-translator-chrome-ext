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
        bottomOffset: 8,
        captionRows: 2,
        captionWidth: 80,
        deepgramApiKey: 'deepgram-secret',
        deeplApiKey: 'deepl-secret',
        geminiApiKey: 'gemini-secret',
        geminiTargetLanguage: 'zh-Hant',
        maxLineWidth: 90,
        minLineWidth: 40,
        originalFontSize: 24,
        sourceLanguage: 'EN',
        sourceLocale: 'en-US',
        targetLanguage: 'ZH-HANT',
        transcriber: 'deepgram',
        translationFontSize: 22,
      },
    };

    const persisted = redactSessionSnapshot(snapshot);

    expect(JSON.stringify(persisted)).not.toContain('secret');
    expect(persisted).toEqual({
      sessionId: 'session-1',
      tabId: 42,
      settings: {
        backgroundOpacity: 78,
        bottomOffset: 8,
        captionRows: 2,
        captionWidth: 80,
        geminiTargetLanguage: 'zh-Hant',
        maxLineWidth: 90,
        minLineWidth: 40,
        originalFontSize: 24,
        sourceLanguage: 'EN',
        sourceLocale: 'en-US',
        targetLanguage: 'ZH-HANT',
        transcriber: 'deepgram',
        translationFontSize: 22,
      },
    });
  });
});
