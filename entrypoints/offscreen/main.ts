import { createBrowserTabAudioPipeline } from '../../src/audio/browser-tab-audio-pipeline';
import {
  createDeepgramSession,
  OffscreenCaptureController,
} from '../../src/audio/offscreen-capture-controller';
import type { ExtensionMessage } from '../../src/core/messages';

const controller = new OffscreenCaptureController({
  createPipeline: createBrowserTabAudioPipeline,
  createSession: createDeepgramSession,
  emitDisconnect: (sessionId) => {
    stopKeepAlive(sessionId);
    void chrome.runtime.sendMessage<ExtensionMessage>({
      target: 'background',
      type: 'CAPTURE_DISCONNECTED',
      payload: { sessionId },
    });
  },
  emitTranscript: (sessionId, event) => {
    void chrome.runtime.sendMessage<ExtensionMessage>({
      target: 'background',
      type: 'TRANSCRIPT_EVENT',
      payload: { event, sessionId },
    });
  },
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
        stopKeepAlive(sessionId);
        return controller.stop(sessionId);
      })
      .catch(() => undefined);
  }, 20_000);
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.target !== 'offscreen') return false;
    const operation = message.type === 'CAPTURE_START'
      ? controller.start(message.payload).then(() => {
          startKeepAlive(message.payload.sessionId);
        })
      : controller.stop(message.payload.sessionId).finally(() =>
          stopKeepAlive(message.payload.sessionId),
        );
    void operation.then(
      () => sendResponse({ ok: true }),
      (error: unknown) =>
        sendResponse({
          error: error instanceof Error ? error.message : 'Unknown audio error',
          ok: false,
        }),
    );
    return true;
  },
);
