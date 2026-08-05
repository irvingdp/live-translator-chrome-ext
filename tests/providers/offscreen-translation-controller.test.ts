import { describe, expect, it, vi } from 'vitest';

import {
  ProviderError,
  type TranslationRequest,
  type TranslationResult,
} from '../../src/providers/deepl';
import {
  normalizeTranslationAttemptError,
  OffscreenTranslationController,
} from '../../src/providers/offscreen-translation-controller';

const request: TranslationRequest = {
  apiKey: 'secret',
  sourceLanguage: 'EN',
  targetLanguage: 'ZH-HANT',
  text: 'Hello',
};

function createHarness() {
  const translate = vi.fn<(
    request: TranslationRequest,
    signal?: AbortSignal,
  ) => Promise<TranslationResult>>();
  const delays: number[] = [];
  const controller = new OffscreenTranslationController({
    delay: async (milliseconds, signal) => {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      delays.push(milliseconds);
    },
    translate,
  });
  return { controller, delays, translate };
}

describe('OffscreenTranslationController', () => {
  it('normalizes an unexpected offscreen rejection to an allowed error code', () => {
    expect(normalizeTranslationAttemptError(new Error('secret upstream detail')))
      .toBe('invalid_response');
  });

  it('retries transient failures and resets the counter after success', async () => {
    const { controller, delays, translate } = createHarness();
    translate
      .mockRejectedValueOnce(new ProviderError('network_error'))
      .mockRejectedValueOnce(new ProviderError('network_error'))
      .mockRejectedValueOnce(new ProviderError('network_error'))
      .mockRejectedValueOnce(new ProviderError('network_error'))
      .mockResolvedValueOnce({ text: '你好' })
      .mockRejectedValueOnce(new ProviderError('network_error'))
      .mockRejectedValueOnce(new ProviderError('network_error'))
      .mockRejectedValueOnce(new ProviderError('network_error'))
      .mockRejectedValueOnce(new ProviderError('network_error'))
      .mockResolvedValueOnce({ text: '世界' });
    controller.startSession('session-1');

    await expect(controller.translate('session-1', 'request-1', request))
      .resolves.toEqual({ ok: true, text: '你好' });
    await expect(controller.translate('session-1', 'request-2', request))
      .resolves.toEqual({ ok: true, text: '世界' });
    expect(translate).toHaveBeenCalledTimes(10);
    expect(delays).toEqual([
      250, 500, 1_000, 2_000,
      250, 500, 1_000, 2_000,
    ]);
  });

  it('opens the circuit on the fifth consecutive failure', async () => {
    const { controller, delays, translate } = createHarness();
    translate.mockRejectedValue(new ProviderError('network_error'));
    controller.startSession('session-1');

    await expect(controller.translate('session-1', 'request-1', request))
      .resolves.toEqual({ error: 'translation_disabled', ok: false });
    expect(translate).toHaveBeenCalledTimes(5);
    expect(delays).toEqual([250, 500, 1_000, 2_000]);

    await controller.translate('session-1', 'request-2', request);
    expect(translate).toHaveBeenCalledTimes(5);
  });

  it('restores the retry budget for a new session', async () => {
    const { controller, translate } = createHarness();
    translate.mockRejectedValue(new ProviderError('network_error'));
    controller.startSession('session-1');
    await controller.translate('session-1', 'request-1', request);

    controller.startSession('session-2');
    translate.mockResolvedValueOnce({ text: '重新開始' });
    await expect(controller.translate('session-2', 'request-2', request))
      .resolves.toEqual({ ok: true, text: '重新開始' });
  });

  it('does not count cancellation as a failed attempt', async () => {
    const { controller, translate } = createHarness();
    translate.mockImplementation((_request, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      );
    }));
    controller.startSession('session-1');

    const pending = controller.translate('session-1', 'request-1', request);
    controller.cancel('request-1');
    await expect(pending).resolves.toEqual({ error: 'cancelled', ok: false });

    translate.mockResolvedValueOnce({ text: '仍可翻譯' });
    await expect(controller.translate('session-1', 'request-2', request))
      .resolves.toEqual({ ok: true, text: '仍可翻譯' });
  });

  it('serializes concurrent work so the circuit never overshoots five calls', async () => {
    const { controller, translate } = createHarness();
    translate.mockRejectedValue(new ProviderError('network_error'));
    controller.startSession('session-1');

    const first = controller.translate('session-1', 'request-1', request);
    const second = controller.translate('session-1', 'request-2', request);

    await expect(first).resolves.toEqual({
      error: 'translation_disabled',
      ok: false,
    });
    await expect(second).resolves.toEqual({
      error: 'translation_disabled',
      ok: false,
    });
    expect(translate).toHaveBeenCalledTimes(5);
  });

  it('cancels a pending retry delay without consuming the next request budget', async () => {
    const translate = vi.fn<(
      request: TranslationRequest,
      signal?: AbortSignal,
    ) => Promise<TranslationResult>>()
      .mockRejectedValueOnce(new ProviderError('network_error'))
      .mockRejectedValueOnce(new ProviderError('network_error'))
      .mockRejectedValueOnce(new ProviderError('network_error'))
      .mockRejectedValueOnce(new ProviderError('network_error'))
      .mockRejectedValueOnce(new ProviderError('network_error'))
      .mockRejectedValueOnce(new ProviderError('network_error'));
    const delays: number[] = [];
    let waitForAbort = true;
    const delay = vi.fn(async (milliseconds: number, signal: AbortSignal) => {
      delays.push(milliseconds);
      if (!waitForAbort) return;

      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          waitForAbort = false;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    const controller = new OffscreenTranslationController({ delay, translate });
    controller.startSession('session-1');

    const pending = controller.translate('session-1', 'request-1', request);
    await vi.waitFor(() => expect(delay).toHaveBeenCalledOnce());
    controller.cancel('request-1');

    await expect(pending).resolves.toEqual({ error: 'cancelled', ok: false });
    expect(translate).toHaveBeenCalledTimes(1);
    await expect(controller.translate('session-1', 'request-2', request))
      .resolves.toEqual({ error: 'translation_disabled', ok: false });
    expect(translate).toHaveBeenCalledTimes(6);
    expect(delays).toEqual([250, 250, 500, 1_000, 2_000]);
  });

  it('does not retry after session replacement when an aborted delay resolves', async () => {
    const translate = vi.fn<(
      request: TranslationRequest,
      signal?: AbortSignal,
    ) => Promise<TranslationResult>>().mockRejectedValue(
      new ProviderError('network_error'),
    );
    let resolveFirstDelay: (() => void) | undefined;
    let delayCalls = 0;
    const delay = vi.fn(() => {
      delayCalls += 1;
      if (delayCalls > 1) return Promise.resolve();

      return new Promise<void>((resolve) => {
        resolveFirstDelay = resolve;
      });
    });
    const controller = new OffscreenTranslationController({ delay, translate });
    controller.startSession('session-1');

    const pending = controller.translate('session-1', 'request-1', request);
    await vi.waitFor(() => expect(delay).toHaveBeenCalledOnce());
    controller.startSession('session-2');
    resolveFirstDelay?.();

    await expect(pending).resolves.toEqual({ error: 'cancelled', ok: false });
    expect(translate).toHaveBeenCalledTimes(1);
    await expect(controller.translate('session-2', 'request-2', request))
      .resolves.toEqual({ error: 'translation_disabled', ok: false });
    expect(translate).toHaveBeenCalledTimes(6);
  });
});
