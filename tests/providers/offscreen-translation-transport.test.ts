import { describe, expect, it } from 'vitest';

import type { ExtensionMessage } from '../../src/core/messages';
import type { TranslationRequest } from '../../src/providers/deepl';
import type { TranslationAttemptResult } from '../../src/providers/offscreen-translation-controller';
import { createOffscreenTranslationTransport } from '../../src/providers/offscreen-translation-transport';

const request: TranslationRequest = {
  apiKey: 'secret',
  sourceLanguage: 'EN',
  targetLanguage: 'ZH-HANT',
  text: 'Hello',
};

describe('createOffscreenTranslationTransport', () => {
  it('returns translated text from the offscreen response', async () => {
    const sent: ExtensionMessage[] = [];
    const translate = createOffscreenTranslationTransport(async (message) => {
      sent.push(message);
      return { ok: true, text: '你好' };
    }, () => 'request-1');

    await expect(translate('session-1', request, new AbortController().signal))
      .resolves.toBe('你好');
    expect(sent).toEqual([{
      target: 'offscreen',
      type: 'TRANSLATE_REQUEST',
      payload: { request, requestId: 'request-1', sessionId: 'session-1' },
    }]);
  });

  it('sends cancellation for the matching request ID', async () => {
    const sent: ExtensionMessage[] = [];
    const gate = Promise.withResolvers<TranslationAttemptResult>();
    const translate = createOffscreenTranslationTransport(async (message) => {
      sent.push(message);
      if (message.type === 'TRANSLATE_REQUEST') return gate.promise;
      return { error: 'cancelled', ok: false };
    }, () => 'request-1');
    const controller = new AbortController();

    const pending = translate('session-1', request, controller.signal);
    controller.abort();
    gate.resolve({ error: 'cancelled', ok: false });

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(sent[1]).toEqual({
      target: 'offscreen',
      type: 'TRANSLATE_CANCEL',
      payload: { requestId: 'request-1', sessionId: 'session-1' },
    });
  });

  it('does not send a request when the signal is already aborted', async () => {
    const sent: ExtensionMessage[] = [];
    const translate = createOffscreenTranslationTransport(async (message) => {
      sent.push(message);
      return { ok: true, text: '你好' };
    }, () => 'request-1');
    const controller = new AbortController();
    controller.abort();

    await expect(translate('session-1', request, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(sent).toEqual([]);
  });

  it('preserves an offscreen error code on the rejection', async () => {
    const translate = createOffscreenTranslationTransport(async () => ({
      error: 'translation_disabled',
      ok: false,
    }), () => 'request-1');

    await expect(translate('session-1', request, new AbortController().signal))
      .rejects.toMatchObject({ code: 'translation_disabled' });
  });
});
