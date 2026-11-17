import { createBrowserTabAudioPipeline } from '../../src/audio/browser-tab-audio-pipeline';
import {
  createCaptureSession,
  OffscreenCaptureController,
} from '../../src/audio/offscreen-capture-controller';
import type { ExtensionMessage } from '../../src/core/messages';
import { LocalWhisperEngine, samplesFromWavBase64 } from '../../src/read-ahead/local-whisper-engine';
import { ChunkTranslationError } from '../../src/read-ahead/gemini-chunk-translation';
import {
  isMessageEnvelope,
  isTrustedExtensionContext,
} from '../../src/core/message-security';

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
    void chrome.runtime.sendMessage<ExtensionMessage>({
      target: 'background',
      type: 'CAPTION_PAIR_UPDATES',
      payload: { sessionId, updates: event.updates },
    });
  },
});

// Local Whisper (issue #15): created on first use, so live captions never
// load the library.
let localWhisper: LocalWhisperEngine | undefined;
const PROGRESS_INTERVAL_MS = 500;
const localWhisperEngine = () =>
  (localWhisper ??= new LocalWhisperEngine(chrome.runtime.getURL('/ort/')));

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
        case 'LOCAL_WHISPER_LOAD': {
          const { download, model } = message.payload;
          if (!download) {
            await localWhisperEngine().load(model);
            return { ok: true } as const;
          }
          // A download can take many minutes, longer than Chrome lets the
          // service worker wait on one message: answered at once, it reports
          // its progress and its end as messages of its own.
          const report = (payload: Extract<ExtensionMessage, { type: 'LOCAL_WHISPER_PROGRESS' }>['payload']) =>
            void chrome.runtime.sendMessage<ExtensionMessage>({
              target: 'background',
              type: 'LOCAL_WHISPER_PROGRESS',
              payload,
            }).catch(() => undefined);
          let lastReport = 0;
          void localWhisperEngine().load(model, (progress) => {
            if (Date.now() - lastReport < PROGRESS_INTERVAL_MS) return;
            lastReport = Date.now();
            report({ model, state: 'downloading', ...progress });
          }).then(
            () => report({ loadedMB: 0, model, state: 'done', totalMB: 0 }),
            (error: unknown) => report({
              error: error instanceof Error ? error.message : String(error),
              loadedMB: 0,
              model,
              state: 'failed',
              totalMB: 0,
            }),
          );
          return { ok: true } as const;
        }
        case 'LOCAL_WHISPER_TRANSCRIBE': {
          const { audioBase64, model, sourceLanguage } = message.payload;
          try {
            const { sentences } = await localWhisperEngine().transcribe(
              model,
              samplesFromWavBase64(audioBase64),
              sourceLanguage,
            );
            return { ok: true, sentences } as const;
          } catch (error) {
            return {
              error: error instanceof ChunkTranslationError ? error.code : 'provider_unavailable',
              ok: false,
            } as const;
          }
        }
        case 'LOCAL_WHISPER_UNLOAD':
          await localWhisper?.unload();
          return { ok: true } as const;
        case 'CAPTURE_CONFIG_UPDATE':
          controller.updateMaxLineWidth(
            message.payload.sessionId,
            message.payload.maxLineWidth,
          );
          return { ok: true } as const;
      }
    })();
    void operation.then(
      sendResponse,
      (error: unknown) =>
        sendResponse({
          error: error instanceof Error ? error.message : 'Unknown audio error',
          ok: false,
        }),
    );
    return true;
  },
);
