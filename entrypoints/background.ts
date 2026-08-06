import { CaptureSessionController } from '../src/core/capture-session-controller';
import { ensureContentScript } from '../src/core/content-script-loader';
import type { ExtensionMessage } from '../src/core/messages';
import { normalizeSettings, type AppSettings } from '../src/core/settings';
import { redactSessionSnapshot } from '../src/core/session-persistence';
import { createOffscreenTranslationTransport } from '../src/providers/offscreen-translation-transport';

export default defineBackground(() => {
  const activeSessionKey = 'activeSession';
  let lifecycleTail: Promise<void> = Promise.resolve();
  const translateOffscreen = createOffscreenTranslationTransport(
    (message) => chrome.runtime.sendMessage(message),
  );
  const sendToOffscreen = async (message: ExtensionMessage) => {
    const response = await chrome.runtime.sendMessage(message) as {
      error?: string;
      ok?: boolean;
    };
    if (!response?.ok) throw new Error(response?.error ?? 'offscreen_error');
    return response;
  };
  const controller = new CaptureSessionController({
    ensureContentScript: (tabId) => ensureContentScript({
      inject: async () => {
        await chrome.scripting.executeScript({
          files: ['content-scripts/captions.js'],
          target: { tabId },
        });
      },
      ping: () => chrome.tabs.sendMessage(tabId, { type: 'CONTENT_PING' }),
    }),
    async ensureOffscreen() {
      const offscreenUrl = chrome.runtime.getURL('offscreen.html');
      const existing = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl],
      });
      if (existing.length > 0) return;
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: '擷取使用者選定分頁的音訊以產生即時字幕',
      });
    },
    getStreamId: (tabId) =>
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }),
    sendToOffscreen,
    sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    translate: (sessionId, request, signal) =>
      translateOffscreen(sessionId, request, signal),
  });

  function enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = lifecycleTail.then(operation, operation);
    lifecycleTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function closeOffscreenIfUnused(): Promise<void> {
    if (controller.snapshot()) return;
    try {
      const offscreenUrl = chrome.runtime.getURL('offscreen.html');
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl],
      });
      if (contexts.length > 0) await chrome.offscreen.closeDocument();
    } catch {
      // Chrome may have already discarded the offscreen document.
    }
  }

  async function stopOrphanedOffscreen(sessionId: string): Promise<void> {
    await sendToOffscreen({
      target: 'offscreen',
      type: 'CAPTURE_STOP',
      payload: { sessionId },
    }).catch(() => undefined);
    await closeOffscreenIfUnused();
  }

  const ready = chrome.storage.session.get(activeSessionKey).then(async (stored) => {
    const snapshot = stored[activeSessionKey] as {
      sessionId?: unknown;
      settings?: unknown;
      tabId?: unknown;
    } | undefined;
    if (
      typeof snapshot?.sessionId === 'string' &&
      typeof snapshot.tabId === 'number' &&
      snapshot.settings &&
      typeof snapshot.settings === 'object'
    ) {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL('offscreen.html')],
      });
      if (contexts.length === 0) {
        await chrome.storage.session.remove(activeSessionKey);
        return;
      }
      const local = await chrome.storage.local.get('settings');
      const localSettings =
        local.settings && typeof local.settings === 'object'
          ? local.settings
          : {};
      controller.restore({
        sessionId: snapshot.sessionId,
        settings: normalizeSettings({
          ...snapshot.settings,
          ...localSettings,
        }),
        tabId: snapshot.tabId,
      });
    }
  }).catch(() => undefined);

  chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, sender, sendResponse) => {
      if (message.target !== 'background') return false;

      const operation = (async () => {
        await ready;
        switch (message.type) {
          case 'TRANSCRIPT_EVENT':
            await controller.acceptTranscript(
              message.payload.sessionId,
              message.payload.event,
            );
            return { ok: true };
          case 'CAPTURE_DISCONNECTED':
            return enqueueLifecycle(async () => {
              await controller.handleDisconnect(message.payload.sessionId);
              if (!controller.snapshot()) {
                await chrome.storage.session.remove(activeSessionKey);
                await closeOffscreenIfUnused();
              }
              return { ok: true };
            });
          case 'CAPTURE_KEEPALIVE':
            return enqueueLifecycle(async () => {
              const status = controller.status();
              if (status.state === 'idle') {
                await stopOrphanedOffscreen(message.payload.sessionId);
              }
              return { ok: true, status };
            });
          case 'CONTENT_READY':
            if (sender.tab?.id !== undefined) {
              await controller.handleContentReady(sender.tab.id);
            }
            return { ok: true };
          case 'SESSION_START':
            return enqueueLifecycle(async () => {
              try {
                await controller.start(
                  message.payload.tabId,
                  normalizeSettings(message.payload.settings),
                );
              } catch (error) {
                await chrome.storage.session.remove(activeSessionKey);
                await closeOffscreenIfUnused();
                throw error;
              }
              const snapshot = controller.snapshot();
              if (snapshot) {
                await chrome.storage.session.set({
                  [activeSessionKey]: redactSessionSnapshot(snapshot),
                });
              }
              return { ok: true, status: controller.status() };
            });
          case 'SESSION_STOP':
            return enqueueLifecycle(async () => {
              await controller.stop();
              await chrome.storage.session.remove(activeSessionKey);
              await closeOffscreenIfUnused();
              return { ok: true, status: controller.status() };
            });
          case 'SESSION_STATUS':
            return { ok: true, status: controller.status() };
          default:
            return { error: 'unsupported_message', ok: false };
        }
      })();

      void operation.then(sendResponse, (error: unknown) =>
        sendResponse({
          error: error instanceof Error ? error.message : 'unknown_error',
          ok: false,
          status: controller.status(),
        }),
      );
      return true;
    },
  );

  chrome.tabs.onRemoved.addListener((tabId) => {
    void ready
      .then(() => enqueueLifecycle(async () => {
        const status = controller.status();
        if ('tabId' in status && status.tabId === tabId) {
          await controller.stop();
          await chrome.storage.session.remove(activeSessionKey);
          await closeOffscreenIfUnused();
        }
      }))
      .catch(() => undefined);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const next = normalizeSettings(
      (changes.settings.newValue as Partial<AppSettings> | undefined) ?? {},
    );
    controller.applyLayout(next.maxLineWidth);
  });
});
