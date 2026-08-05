import { describe, expect, it } from 'vitest';

import { redactSessionSnapshot } from '../../src/core/session-persistence';
import type { ActiveSessionSnapshot } from '../../src/core/capture-session-controller';

describe('session persistence', () => {
  it('never copies API credentials into chrome.storage.session', () => {
    const snapshot: ActiveSessionSnapshot = {
      sessionId: 'session-1',
      tabId: 42,
      settings: {
        deepgramApiKey: 'deepgram-secret',
        deeplApiKey: 'deepl-secret',
        originalFontSize: 24,
        sourceLanguage: 'EN',
        sourceLocale: 'en-US',
        targetLanguage: 'ZH-HANT',
        translationFontSize: 22,
      },
    };

    const persisted = redactSessionSnapshot(snapshot);

    expect(JSON.stringify(persisted)).not.toContain('secret');
    expect(persisted).toEqual({
      sessionId: 'session-1',
      tabId: 42,
      settings: {
        originalFontSize: 24,
        sourceLanguage: 'EN',
        sourceLocale: 'en-US',
        targetLanguage: 'ZH-HANT',
        translationFontSize: 22,
      },
    });
  });
});
