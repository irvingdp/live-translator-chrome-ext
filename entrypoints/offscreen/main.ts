import { createBrowserTabAudioPipeline } from '../../src/audio/browser-tab-audio-pipeline';
import {
  createCaptureSession,
  OffscreenCaptureController,
} from '../../src/audio/offscreen-capture-controller';
import type { ExtensionMessage } from '../../src/core/messages';
import {
  isMessageEnvelope,
  isTrustedExtensionContext,
} from '../../src/core/message-security';
import { DeepLClient } from '../../src/providers/deepl';
import {
  normalizeTranslationAttemptError,
  OffscreenTranslationController,
} from '../../src/providers/offscreen-translation-controller';

const controller = new OffscreenCaptureController({
  createPipeline: createBrowserTabAudioPipeline,
  createSession: createCaptureSession,
  emitDisconnect: (sessionId, code) => {
    void teardownSession(sessionId)
      .catch(() => undefined)
      .then(() => chrome.runtime.sendMessage<ExtensionMessage>({
        target: 'background',
        type: 'CAPTURE_DISCONNECTED',
        payload: { code, sessionId },
      }));
  },
  emitEvent: (sessionId, event) => {
    void chrome.runtime.sendMessage<ExtensionMessage>(
      event.kind === 'pair'
        ? {
            target: 'background',
            type: 'CAPTION_PAIR_EVENT',
            payload: { event: event.event, sessionId },
          }
        : {
            target: 'background',
            type: 'TRANSCRIPT_EVENT',
            payload: { event: event.event, sessionId },
          },
    );
  },
});

const deepl = new DeepLClient();
const translationController = new OffscreenTranslationController({
  delay: (milliseconds, signal) => new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  }),
  translate: (request, signal) => deepl.translate(request, signal),
});

let keepAliveSessionId: string | undefined;
let keepAliveTimer: ReturnType<typeof setInterval> | undefined;

function stopKeepAlive(sessionId?: string): void {
  if (sessionId && sessionId !== keepAliveSessionId) return;
  if (keepAliveTimer !== undefined) clearInterval(keepAliveTimer);
  keepAliveTimer = undefined;
  keepAliveSessionId = undefined;
}

function startKeepAlive(sessionId: string): void {
  stopKeepAlive();
  keepAliveSessionId = sessionId;
  keepAliveTimer = setInterval(() => {
    void chrome.runtime
      .sendMessage<ExtensionMessage>({
        target: 'background',
        type: 'CAPTURE_KEEPALIVE',
        payload: { sessionId },
      })
      .then((response: { status?: { state?: string } } | undefined) => {
        if (response?.status?.state !== 'idle') return;
        return teardownSession(sessionId);
      })
      .catch(() => undefined);
  }, 20_000);
}

async function teardownSession(sessionId: string): Promise<void> {
  translationController.stopSession(sessionId);
  await controller.stop(sessionId).finally(() => stopKeepAlive(sessionId));
}

chrome.runtime.onMessage.addListener(
  (incoming: unknown, sender, sendResponse) => {
    if (
      !isMessageEnvelope(incoming, 'offscreen') ||
      !isTrustedExtensionContext(sender, chrome.runtime.id)
    ) {
      return false;
    }
    const message = incoming as ExtensionMessage;
    const operation = (async () => {
      switch (message.type) {
        case 'CAPTURE_START':
          translationController.startSession(message.payload.sessionId);
          try {
            await controller.start(message.payload);
          } catch (error) {
            await teardownSession(message.payload.sessionId).catch(() => undefined);
            throw error;
          }
          startKeepAlive(message.payload.sessionId);
          return { ok: true } as const;
        case 'CAPTURE_STOP':
          await teardownSession(message.payload.sessionId);
          return { ok: true } as const;
        case 'TRANSLATE_REQUEST':
          return translationController.translate(
            message.payload.sessionId,
            message.payload.requestId,
            message.payload.request,
          );
        case 'TRANSLATE_CANCEL':
          translationController.cancel(message.payload.requestId);
          return { error: 'cancelled', ok: false } as const;
      }
    })();
    void operation.then(
      sendResponse,
      (error: unknown) =>
        sendResponse(message.type === 'TRANSLATE_REQUEST'
          ? { error: normalizeTranslationAttemptError(error), ok: false }
          : {
              error: error instanceof Error
                ? error.message
                : 'Unknown audio error',
              ok: false,
            }),
    );
    return true;
  },
);
