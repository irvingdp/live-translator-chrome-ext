import type { ExtensionMessage } from '../core/messages';
import type { TranslationRequest } from './deepl';
import type { TranslationAttemptResult } from './offscreen-translation-controller';

type OffscreenTranslationMessage = Extract<
  ExtensionMessage,
  { target: 'offscreen'; type: 'TRANSLATE_REQUEST' | 'TRANSLATE_CANCEL' }
>;

type SendMessage = (
  message: OffscreenTranslationMessage,
) => Promise<TranslationAttemptResult>;

type RequestIdGenerator = () => string;

export function createOffscreenTranslationTransport(
  sendMessage: SendMessage,
  createRequestId: RequestIdGenerator = () => crypto.randomUUID(),
): (sessionId: string, request: TranslationRequest, signal: AbortSignal) => Promise<string> {
  return async (sessionId, request, signal) => {
    if (signal.aborted) {
      throw new DOMException('Translation cancelled', 'AbortError');
    }

    const requestId = createRequestId();
    const cancel = () => {
      void sendMessage({
        target: 'offscreen',
        type: 'TRANSLATE_CANCEL',
        payload: { requestId, sessionId },
      }).catch(() => undefined);
    };

    signal.addEventListener('abort', cancel, { once: true });

    try {
      const result = await sendMessage({
        target: 'offscreen',
        type: 'TRANSLATE_REQUEST',
        payload: { request, requestId, sessionId },
      });

      if (signal.aborted) {
        throw new DOMException('Translation cancelled', 'AbortError');
      }
      if (result.ok) return result.text;

      throw Object.assign(new Error(result.error), { code: result.error });
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  };
}
