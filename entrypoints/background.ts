import { CaptureSessionController } from '../src/core/capture-session-controller';
import { ensureContentScript } from '../src/core/content-script-loader';
import {
  isExtensionPage,
  isMessageEnvelope,
  isTopFrameContentScript,
} from '../src/core/message-security';
import type { ExtensionMessage } from '../src/core/messages';
import type { MediaPlaybackResponse } from '../src/core/media-playback';
import {
  httpsOrigin,
  layoutForOrigin,
  normalizeOverlayLayout,
  OVERLAY_LAYOUTS_KEY,
  saveLayoutForOrigin,
  type OverlayLayout,
} from '../src/core/overlay-layout';
import {
  DEEPGRAM_REMOVED_NOTICE_KEY,
  migrateStoredSettings,
  normalizeSettings,
  type AppSettings,
} from '../src/core/settings';
import { redactSessionSnapshot } from '../src/core/session-persistence';
import {
  ReadAheadChunkError,
  type WhisperRecognition,
} from '../src/core/capture-session-controller';
import {
  CHUNK_REQUEST_TIMEOUT_MS,
  ChunkTranslationError,
  translateChunk,
  withRequestTimeout,
} from '../src/read-ahead/gemini-chunk-translation';
import { translateOnWeb } from '../src/read-ahead/web-translation';
import {
  GROQ_ORIGIN,
  transcribeChunk,
} from '../src/read-ahead/groq-transcription';
import {
  CLOUDFLARE_ORIGIN,
  transcribeWithCloudflare,
} from '../src/read-ahead/cloudflare-transcription';

const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'm.youtube.com', 'youtube.com']);

export default defineBackground(() => {
  const activeSessionKey = 'activeSession';
  const autoFollowTabsKey = 'autoFollowTabs';
  const browserFullscreenFallbackKey = 'browserFullscreenFallback';
  let lifecycleTail: Promise<void> = Promise.resolve();
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  const onboardingUrl = chrome.runtime.getURL('onboarding.html');
  const popupUrl = chrome.runtime.getURL('popup.html');
  const sidePanelUrl = chrome.runtime.getURL('sidepanel.html');
  const sidePanelPorts = new Set<chrome.runtime.Port>();
  const authorizedTabs = new Map<number, string>();
  const promptedTabs = new Set<number>();
  chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'update') {
      void migrateSettings().catch(() => undefined);
      return;
    }
    if (reason !== 'install') return;
    void chrome.tabs.create({ url: onboardingUrl }).catch(() => undefined);
  });
  // The overlay's button after a recognizer's quota ran out (issue #11):
  // switch read-ahead's recognizer to the next Whisper service. With its key
  // and host permission in place the running session restarts on it, from
  // where the viewer is. Otherwise they can only be set up in the popup: the
  // captions stop, and the popup opens (or, where Chrome refuses, the options
  // page) with that service already selected.
  async function switchReadAheadRecognizer(
    tabId: number,
    recognizer: 'cloudflare' | 'groq',
  ): Promise<{ ok: true; switched: boolean }> {
    const status = controller.status();
    const stored = await chrome.storage.local.get('settings');
    const settings = normalizeSettings((stored.settings as Partial<AppSettings> | undefined) ?? {});
    if (status.state !== 'running' || status.tabId !== tabId || settings.transcriber !== 'gemini-read-ahead') {
      return { ok: true, switched: false };
    }
    const configured = recognizer === 'cloudflare'
      ? settings.cloudflareAccountId.trim() !== '' && settings.cloudflareApiToken.trim() !== ''
      : settings.groqApiKey.trim() !== '';
    const ready = configured && await chrome.permissions.contains({
      origins: [recognizer === 'cloudflare' ? CLOUDFLARE_ORIGIN : GROQ_ORIGIN],
    }).catch(() => false);
    const next = { ...settings, readAheadRecognizer: recognizer };
    await chrome.storage.local.set({ settings: next });
    if (!ready) {
      await stopSession();
      await chrome.action.openPopup().catch(() => chrome.runtime.openOptionsPage());
      return { ok: true, switched: false };
    }
    await controller.start(tabId, next);
    await persistActiveSession();
    return { ok: true, switched: true };
  }

  // Stops captions the way the popup's switch does. Callers hold the lifecycle.
  async function stopSession(): Promise<void> {
    const statusBeforeStop = controller.status();
    if ('tabId' in statusBeforeStop) {
      await restoreBrowserFullscreenFallback(statusBeforeStop.tabId);
    }
    await controller.stop();
    await chrome.storage.session.remove(activeSessionKey);
    await clearAllAutoFollowBadges();
    await closeOffscreenIfUnused();
  }

  // Rewrites settings stored before 1.5.0 (Deepgram's key and fields go; a
  // Deepgram user lands on Gemini live), so they do not linger in storage.
  async function migrateSettings(): Promise<void> {
    const stored = await chrome.storage.local.get('settings');
    if (!stored.settings) return;
    const { changed, needsGeminiKeyNotice, settings } = migrateStoredSettings(stored.settings);
    if (!changed) return;
    await chrome.storage.local.set({
      settings,
      ...(needsGeminiKeyNotice ? { [DEEPGRAM_REMOVED_NOTICE_KEY]: true } : {}),
    });
  }
  const sendToOffscreen = async (message: ExtensionMessage) => {
    const response = await chrome.runtime.sendMessage(message) as {
      error?: string;
      ok?: boolean;
    };
    if (!response?.ok) throw new Error(response?.error ?? 'offscreen_error');
    return response;
  };
  const ensureTabContentScript = (tabId: number) =>
    ensureContentScript({
      inject: async () => {
        await chrome.scripting.executeScript({
          files: ['captions.js'],
          target: { tabId },
        });
      },
      ping: () => chrome.tabs.sendMessage(tabId, { type: 'CONTENT_PING' }),
    });
  const tabOrigin = async (tabId: number) =>
    httpsOrigin((await chrome.tabs.get(tabId)).url);
  const getOverlayLayout = async (tabId: number) => {
    const origin = await tabOrigin(tabId);
    if (!origin) return undefined;
    const stored = await chrome.storage.local.get(OVERLAY_LAYOUTS_KEY);
    return layoutForOrigin(stored[OVERLAY_LAYOUTS_KEY], origin);
  };
  const persistOverlayLayout = async (
    tabId: number,
    layout: OverlayLayout,
  ) => {
    const origin = await tabOrigin(tabId);
    if (!origin) return normalizeOverlayLayout(layout);
    const stored = await chrome.storage.local.get(OVERLAY_LAYOUTS_KEY);
    const next = saveLayoutForOrigin(
      stored[OVERLAY_LAYOUTS_KEY],
      origin,
      layout,
    );
    await chrome.storage.local.set({ [OVERLAY_LAYOUTS_KEY]: next });
    return next.layouts[origin]!;
  };
  const controller = new CaptureSessionController({
    ensureContentScript: ensureTabContentScript,
    async ensureOffscreen() {
      const existing = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl],
      });
      if (existing.length > 0) return;
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification:
          'Capture the audio of the tab the user selected to produce live captions',
      });
    },
    getStreamId: (tabId) =>
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }),
    getOverlayLayout,
    sendToOffscreen,
    sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    async startReadAhead(tabId, request) {
      const tab = await chrome.tabs.get(tabId);
      const host = tab.url ? new URL(tab.url).hostname : '';
      // The buffer tap must run in the page's own world to see YouTube's
      // MediaSource; everything else stays in the isolated world.
      if (YOUTUBE_HOSTS.has(host)) {
        await chrome.scripting.executeScript({
          files: ['read-ahead-tap.js'],
          target: { tabId },
          world: 'MAIN',
        });
      }
      await chrome.scripting.executeScript({
        files: ['read-ahead.js'],
        target: { tabId },
      });
      await chrome.tabs.sendMessage(tabId, {
        type: 'READ_AHEAD_START',
        payload: request,
      });
    },
    async stopReadAhead(tabId, sessionId) {
      await chrome.tabs.sendMessage(tabId, {
        type: 'READ_AHEAD_STOP',
        payload: { sessionId },
      });
    },
    translateChunk: (request) => translateChunk(request),
    translateOnWeb: (request, timeoutMs) =>
      withRequestTimeout((signal) => translateOnWeb(request, signal), timeoutMs),
    transcribeChunk: ({ provider, ...request }) =>
      provider === 'cloudflare'
        ? transcribeWithCloudflare(request as Omit<Extract<WhisperRecognition, { provider: 'cloudflare' }>, 'provider'>)
        : transcribeChunk(request as Omit<Extract<WhisperRecognition, { provider: 'groq' }>, 'provider'>),
  });

  async function persistAuthorizedTabs(): Promise<void> {
    await chrome.storage.session.set({
      [autoFollowTabsKey]: Object.fromEntries(
        [...authorizedTabs].map(([tabId, origin]) => [String(tabId), origin]),
      ),
    });
  }

  async function clearAutoFollowBadge(tabId: number): Promise<void> {
    promptedTabs.delete(tabId);
    await Promise.all([
      chrome.action.setBadgeText({ tabId, text: '' }),
      chrome.action.setTitle({
        tabId,
        title: chrome.i18n.getMessage('extName'),
      }),
    ]).then(() => undefined, () => undefined);
  }

  async function promptAutoFollowAuthorization(tabId: number): Promise<void> {
    if (promptedTabs.has(tabId)) return;
    promptedTabs.add(tabId);
    await Promise.all([
      chrome.action.setBadgeBackgroundColor({ color: '#f59e0b', tabId }),
      chrome.action.setBadgeText({ tabId, text: '!' }),
      chrome.action.setTitle({
        tabId,
        title: chrome.i18n.getMessage('autoFollowAuthorizationHint'),
      }),
    ]).then(() => undefined, () => undefined);
  }

  async function clearAllAutoFollowBadges(): Promise<void> {
    const tabs = await chrome.tabs.query({});
    const tabIds = new Set([
      ...promptedTabs,
      ...tabs.flatMap((tab) => tab.id === undefined ? [] : [tab.id]),
    ]);
    await Promise.all([...tabIds].map(clearAutoFollowBadge));
  }

  async function revokeAuthorizedTab(tabId: number): Promise<void> {
    if (!authorizedTabs.delete(tabId)) return;
    await persistAuthorizedTabs();
  }

  async function authorizeTab(tabId: number): Promise<boolean> {
    const tab = await chrome.tabs.get(tabId);
    const origin = httpsOrigin(tab.url);
    if (!origin) {
      await clearAutoFollowBadge(tabId);
      return false;
    }
    await chrome.scripting.executeScript({
      files: ['media-playback.js'],
      target: { allFrames: true, tabId },
    });
    authorizedTabs.set(tabId, origin);
    await persistAuthorizedTabs();
    await clearAutoFollowBadge(tabId);
    return true;
  }

  async function isFocusedActiveTab(tabId: number): Promise<boolean> {
    const tab = await chrome.tabs.get(tabId);
    if (tab.active === false || tab.windowId === undefined) return false;
    const window = await chrome.windows.get(tab.windowId);
    return window.focused !== false;
  }

  async function sidePanelState() {
    const status = controller.status();
    if (status.state !== 'running') {
      return {
        type: 'SIDE_PANEL_STATE' as const,
        payload: { active: false, pairs: [], status },
      };
    }
    const layout = await getOverlayLayout(status.tabId);
    return {
      type: 'SIDE_PANEL_STATE' as const,
      payload: {
        active: layout?.mode === 'native',
        appearance: controller.appearance(),
        pairs: controller.captionPairs(),
        status,
      },
    };
  }

  async function broadcastSidePanel(): Promise<void> {
    if (sidePanelPorts.size === 0) return;
    const state = await sidePanelState();
    for (const port of sidePanelPorts) {
      try {
        port.postMessage(state);
      } catch {
        sidePanelPorts.delete(port);
      }
    }
  }

  async function restoreFloatingAfterSidePanelClosed(): Promise<void> {
    if (sidePanelPorts.size > 0) return;
    const status = controller.status();
    if (status.state !== 'running') return;
    const current = await getOverlayLayout(status.tabId);
    if (sidePanelPorts.size > 0 || current?.mode !== 'native') return;
    const layout = await persistOverlayLayout(status.tabId, {
      ...current,
      mode: 'floating',
    });
    await chrome.tabs.sendMessage(status.tabId, {
      type: 'OVERLAY_LAYOUT',
      payload: { layout },
    });
  }

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

  type BrowserFullscreenFallback = {
    previousState: NonNullable<chrome.windows.Window['state']>;
    tabId: number;
    windowId: number;
  };

  async function storedBrowserFullscreenFallback(): Promise<
    BrowserFullscreenFallback | undefined
  > {
    const stored = await chrome.storage.session.get(browserFullscreenFallbackKey);
    const value = stored[browserFullscreenFallbackKey] as Partial<
      BrowserFullscreenFallback
    > | undefined;
    if (
      typeof value?.tabId !== 'number' ||
      typeof value.windowId !== 'number' ||
      typeof value.previousState !== 'string'
    ) return undefined;
    return value as BrowserFullscreenFallback;
  }

  async function enterBrowserFullscreenFallback(
    tabId: number,
    windowId: number,
  ) {
    const existing = await storedBrowserFullscreenFallback();
    if (existing?.tabId === tabId && existing.windowId === windowId) {
      return { active: true, forced: true, ok: true };
    }
    if (existing) await restoreBrowserFullscreenFallback();

    const currentWindow = await chrome.windows.get(windowId);
    if (currentWindow.state === chrome.windows.WindowState.FULLSCREEN) {
      return { active: true, forced: false, ok: true };
    }
    const fallback: BrowserFullscreenFallback = {
      previousState: currentWindow.state ?? chrome.windows.WindowState.NORMAL,
      tabId,
      windowId,
    };
    await chrome.storage.session.set({
      [browserFullscreenFallbackKey]: fallback,
    });
    try {
      await chrome.windows.update(windowId, {
        state: chrome.windows.WindowState.FULLSCREEN,
      });
    } catch (error) {
      await chrome.storage.session.remove(browserFullscreenFallbackKey);
      throw error;
    }
    return { active: true, forced: true, ok: true };
  }

  async function restoreBrowserFullscreenFallback(tabId?: number): Promise<void> {
    const existing = await storedBrowserFullscreenFallback();
    if (!existing || (tabId !== undefined && existing.tabId !== tabId)) return;
    await chrome.storage.session.remove(browserFullscreenFallbackKey);
    await chrome.windows.update(existing.windowId, {
      state: existing.previousState,
    }).catch(() => undefined);
  }

  async function persistActiveSession(previousTabId?: number): Promise<void> {
    const snapshot = controller.snapshot();
    if (!snapshot) {
      await chrome.storage.session.remove(activeSessionKey);
      return;
    }
    if (previousTabId !== undefined && previousTabId !== snapshot.tabId) {
      await chrome.sidePanel.setOptions({
        enabled: false,
        tabId: previousTabId,
      }).catch(() => undefined);
    }
    await chrome.sidePanel.setOptions({
      enabled: true,
      path: 'sidepanel.html',
      tabId: snapshot.tabId,
    });
    await chrome.storage.session.set({
      [activeSessionKey]: redactSessionSnapshot(snapshot),
    });
  }

  async function transferToTab(tabId: number): Promise<boolean> {
    const source = controller.snapshot();
    if (!source || source.tabId === tabId || !authorizedTabs.has(tabId)) {
      return false;
    }
    if (!await isFocusedActiveTab(tabId)) return false;

    try {
      const savedLayout = await getOverlayLayout(tabId);
      if (savedLayout?.mode === 'native') {
        await persistOverlayLayout(tabId, {
          ...savedLayout,
          mode: 'floating',
        });
      }
      await controller.transfer(tabId);
      if (controller.snapshot()?.tabId !== tabId) return false;
      await restoreBrowserFullscreenFallback(source.tabId);
      await persistActiveSession(source.tabId);
      await clearAutoFollowBadge(tabId);
      return true;
    } catch (error) {
      const current = controller.status();
      if (current.state === 'running' && current.tabId === source.tabId) {
        await revokeAuthorizedTab(tabId);
        await promptAutoFollowAuthorization(tabId);
        throw error;
      }

      try {
        await controller.start(source.tabId, source.settings);
        await persistActiveSession(tabId);
      } catch {
        await chrome.storage.session.remove(activeSessionKey);
        await closeOffscreenIfUnused();
      }
      throw error;
    }
  }

  const ready = chrome.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  }).then(async () => {
    const authorized = await chrome.storage.session.get(autoFollowTabsKey);
    const storedTabs = authorized[autoFollowTabsKey];
    if (storedTabs && typeof storedTabs === 'object') {
      for (const [tabId, origin] of Object.entries(storedTabs)) {
        const parsedTabId = Number(tabId);
        if (Number.isInteger(parsedTabId) && typeof origin === 'string') {
          authorizedTabs.set(parsedTabId, origin);
        }
      }
    }
    const stored = await chrome.storage.session.get(activeSessionKey);
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
        documentUrls: [offscreenUrl],
      });
      // Read-ahead runs in the tab, not the offscreen document, so it
      // survives this worker being shut down while the video sat paused.
      const readAhead = (snapshot.settings as { transcriber?: unknown })
        .transcriber === 'gemini-read-ahead';
      if (contexts.length === 0 && !readAhead) {
        await chrome.storage.session.remove(activeSessionKey);
        await restoreBrowserFullscreenFallback(snapshot.tabId);
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
      await chrome.sidePanel.setOptions({
        enabled: true,
        path: 'sidepanel.html',
        tabId: snapshot.tabId,
      });
      return;
    }
    await restoreBrowserFullscreenFallback();
  });
  void ready.catch(() => undefined);
  void ready.then(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (tab?.id === undefined) return;
    if (authorizedTabs.has(tab.id)) await clearAutoFollowBadge(tab.id);
    else await promptAutoFollowAuthorization(tab.id);
  }).catch(() => undefined);

  chrome.runtime.onConnect.addListener((port) => {
    if (
      port.name !== 'caption-side-panel' ||
      !isExtensionPage(port.sender ?? {}, chrome.runtime.id, sidePanelUrl)
    ) return;
    sidePanelPorts.add(port);
    port.onDisconnect.addListener(() => {
      sidePanelPorts.delete(port);
      if (sidePanelPorts.size === 0) {
        void enqueueLifecycle(restoreFloatingAfterSidePanelClosed)
          .catch(() => undefined);
      }
    });
    void ready
      .then(() => sidePanelState())
      .then((state) => port.postMessage(state))
      .catch(() => sidePanelPorts.delete(port));
  });

  const offscreenMessageTypes = new Set([
    'CAPTION_PAIR_UPDATES',
    'CAPTURE_DISCONNECTED',
    'CAPTURE_KEEPALIVE',
  ]);
  const popupMessageTypes = new Set([
    'SESSION_AUTHORIZE_TAB',
    'SESSION_START',
    'SESSION_STATUS',
    'SESSION_STOP',
  ]);
  const contentMessageTypes = new Set([
    'READ_AHEAD_CUE',
    'READ_AHEAD_STATUS',
    'READ_AHEAD_SWITCH_RECOGNIZER',
    'READ_AHEAD_TRANSLATE',
    'READ_AHEAD_WEB_TRANSLATE',
    'BROWSER_FULLSCREEN_FALLBACK',
    'CLEAR_CAPTIONS',
    'CONTENT_READY',
    'OPEN_SIDE_PANEL',
    'OVERLAY_APPEARANCE_CHANGED',
    'OVERLAY_LAYOUT_CHANGED',
  ]);

  function isAuthorizedMessage(
    message: { type: string },
    sender: chrome.runtime.MessageSender,
  ): boolean {
    if (offscreenMessageTypes.has(message.type)) {
      return isExtensionPage(
        sender,
        chrome.runtime.id,
        offscreenUrl,
      );
    }
    if (popupMessageTypes.has(message.type)) {
      return isExtensionPage(sender, chrome.runtime.id, popupUrl);
    }
    if (message.type === 'MEDIA_PLAYING') {
      return sender.id === chrome.runtime.id && sender.tab?.id !== undefined;
    }
    if (message.type === 'OVERLAY_APPEARANCE_CHANGED') {
      return isTopFrameContentScript(sender, chrome.runtime.id) ||
        isExtensionPage(sender, chrome.runtime.id, sidePanelUrl);
    }
    return contentMessageTypes.has(message.type) &&
      isTopFrameContentScript(sender, chrome.runtime.id);
  }

  chrome.runtime.onMessage.addListener(
    (incoming: unknown, sender, sendResponse) => {
      if (
        !isMessageEnvelope(incoming, 'background') ||
        !isAuthorizedMessage(incoming, sender)
      ) {
        return false;
      }
      const message = incoming as ExtensionMessage;

      // Chrome only permits sidePanel.open() in the direct call stack of a
      // user gesture. Capture its promise before entering any awaited work.
      const sidePanelOpen = message.type === 'OPEN_SIDE_PANEL' &&
        sender.tab?.id !== undefined
        ? chrome.sidePanel.open({ tabId: sender.tab.id })
        : undefined;
      // A stale content instance can race with session shutdown. Keep Chrome's
      // rejected open promise observed even when the status check returns
      // before this operation needs to await it.
      void sidePanelOpen?.catch(() => undefined);

      const operation = (async () => {
        await ready;
        switch (message.type) {
          case 'CAPTION_PAIR_UPDATES':
            await controller.acceptCaptionPairs(
              message.payload.sessionId,
              message.payload.updates,
            );
            return { ok: true };
          case 'CAPTURE_DISCONNECTED':
            return enqueueLifecycle(async () => {
              await controller.handleDisconnect(
                message.payload.sessionId,
                message.payload.code,
              );
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
          case 'READ_AHEAD_TRANSLATE': {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return { error: 'missing_tab', ok: false };
            try {
              const result = await controller.translateReadAheadChunk(
                message.payload.sessionId,
                tabId,
                message.payload.audioBase64,
              );
              return { ok: true, ...result };
            } catch (error) {
              return {
                error: error instanceof ReadAheadChunkError || error instanceof ChunkTranslationError
                  ? error.code
                  : error instanceof Error ? error.message : 'unknown_error',
                ok: false,
              };
            }
          }
          case 'READ_AHEAD_SWITCH_RECOGNIZER': {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return { error: 'missing_tab', ok: false };
            const { recognizer } = message.payload;
            if (recognizer !== 'groq' && recognizer !== 'cloudflare') {
              return { error: 'unsupported_recognizer', ok: false };
            }
            return enqueueLifecycle(() => switchReadAheadRecognizer(tabId, recognizer));
          }
          case 'READ_AHEAD_WEB_TRANSLATE': {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return { error: 'missing_tab', ok: false };
            const { sessionId, sourceLanguage, targetLanguage, texts, timeoutMs } = message.payload;
            if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string')) {
              return { error: 'invalid_request', ok: false };
            }
            try {
              const translations = await controller.translateReadAheadTexts(
                sessionId,
                tabId,
                { ...(sourceLanguage ? { sourceLanguage } : {}), targetLanguage, texts },
                // The page's budget, never more than one request's.
                Math.min(CHUNK_REQUEST_TIMEOUT_MS, Math.max(500, Number(timeoutMs) || 0)),
              );
              return { ok: true, translations };
            } catch (error) {
              return {
                error: error instanceof ChunkTranslationError ? error.code
                  : error instanceof Error ? error.message : 'unknown_error',
                ok: false,
              };
            }
          }
          case 'READ_AHEAD_CUE': {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return { error: 'missing_tab', ok: false };
            await controller.acceptReadAheadCue(
              message.payload.sessionId,
              tabId,
              message.payload.cue,
            );
            return { ok: true };
          }
          case 'READ_AHEAD_STATUS': {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return { error: 'missing_tab', ok: false };
            await controller.acceptReadAheadStatus(
              message.payload.sessionId,
              tabId,
              message.payload.status,
            );
            return { ok: true };
          }
          case 'CONTENT_READY':
            if (sender.tab?.id !== undefined) {
              await controller.handleContentReady(sender.tab.id);
            }
            return { ok: true };
          case 'MEDIA_PLAYING': {
            const tabId = sender.tab?.id;
            if (tabId === undefined || !authorizedTabs.has(tabId)) {
              return { error: 'unauthorized_tab', ok: false };
            }
            return enqueueLifecycle(async () => ({
              ok: true,
              transferred: await transferToTab(tabId),
            }));
          }
          case 'CLEAR_CAPTIONS': {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return { error: 'missing_tab', ok: false };
            const cleared = await controller.clearCaptions(tabId);
            return cleared ? { ok: true } : { error: 'inactive_tab', ok: false };
          }
          case 'BROWSER_FULLSCREEN_FALLBACK': {
            const tabId = sender.tab?.id;
            const windowId = sender.tab?.windowId;
            if (tabId === undefined || windowId === undefined) {
              return { error: 'missing_tab', ok: false };
            }
            const status = controller.status();
            if (status.state !== 'running' || status.tabId !== tabId) {
              return { error: 'inactive_tab', ok: false };
            }
            if (message.payload.active) {
              return enterBrowserFullscreenFallback(tabId, windowId);
            }
            await restoreBrowserFullscreenFallback(tabId);
            return { active: false, ok: true };
          }
          case 'OVERLAY_LAYOUT_CHANGED': {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return { error: 'missing_tab', ok: false };
            const status = controller.status();
            if (status.state !== 'running' || status.tabId !== tabId) {
              return { error: 'inactive_tab', ok: false };
            }
            const layout = await persistOverlayLayout(
              tabId,
              message.payload.layout,
            );
            return { layout, ok: true };
          }
          case 'OVERLAY_APPEARANCE_CHANGED': {
            const status = controller.status();
            const tabId = sender.tab?.id ?? (
              status.state === 'running' ? status.tabId : undefined
            );
            if (tabId === undefined) return { error: 'missing_tab', ok: false };
            if (status.state !== 'running' || status.tabId !== tabId) {
              return { error: 'inactive_tab', ok: false };
            }
            const stored = await chrome.storage.local.get('settings');
            const settings = normalizeSettings({
              ...((stored.settings as Partial<AppSettings> | undefined) ?? {}),
              ...message.payload.appearance,
            });
            await chrome.storage.local.set({ settings });
            return { appearance: message.payload.appearance, ok: true };
          }
          case 'OPEN_SIDE_PANEL': {
            const tabId = sender.tab?.id;
            if (tabId === undefined || !sidePanelOpen) {
              return { error: 'missing_tab', ok: false };
            }
            const status = controller.status();
            if (status.state !== 'running' || status.tabId !== tabId) {
              return { error: 'inactive_tab', ok: false };
            }
            await sidePanelOpen;
            const layout = await persistOverlayLayout(tabId, {
              ...message.payload.layout,
              mode: 'native',
            });
            await chrome.tabs.sendMessage(tabId, {
              type: 'OVERLAY_LAYOUT',
              payload: { layout },
            });
            return { layout, ok: true };
          }
          case 'SESSION_START':
            return enqueueLifecycle(async () => {
              try {
                const savedLayout = await getOverlayLayout(message.payload.tabId);
                if (savedLayout?.mode === 'native') {
                  await persistOverlayLayout(message.payload.tabId, {
                    ...savedLayout,
                    mode: 'floating',
                  });
                }
                await controller.start(
                  message.payload.tabId,
                  normalizeSettings(message.payload.settings),
                );
                if (!authorizedTabs.has(message.payload.tabId)) {
                  await authorizeTab(message.payload.tabId).catch(() => false);
                }
              } catch (error) {
                await chrome.storage.session.remove(activeSessionKey);
                await closeOffscreenIfUnused();
                throw error;
              }
              await persistActiveSession();
              return { ok: true, status: controller.status() };
            });
          case 'SESSION_AUTHORIZE_TAB':
            return enqueueLifecycle(async () => ({
              authorized: await authorizeTab(message.payload.tabId),
              ok: true,
            }));
          case 'SESSION_STOP':
            return enqueueLifecycle(async () => {
              await stopSession();
              return { ok: true, status: controller.status() };
            });
          case 'SESSION_STATUS':
            return { ok: true, status: controller.status() };
          default:
            return { error: 'unsupported_message', ok: false };
        }
      })();

      void operation.then(
        async (response) => {
          await broadcastSidePanel().catch(() => undefined);
          sendResponse(response);
        },
        (error: unknown) => {
          void broadcastSidePanel();
          sendResponse({
            error: error instanceof Error ? error.message : 'unknown_error',
            ok: false,
            status: controller.status(),
          });
        },
      );
      return true;
    },
  );

  chrome.tabs.onRemoved.addListener((tabId) => {
    void ready
      .then(() => enqueueLifecycle(async () => {
        await revokeAuthorizedTab(tabId);
        await clearAutoFollowBadge(tabId);
        const status = controller.status();
        if ('tabId' in status && status.tabId === tabId) {
          await restoreBrowserFullscreenFallback(tabId);
          await controller.stop();
          await chrome.storage.session.remove(activeSessionKey);
          await closeOffscreenIfUnused();
        }
      }))
      .catch(() => undefined);
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void ready
      .then(() => enqueueLifecycle(async () => {
        if (!authorizedTabs.has(tabId)) {
          await promptAutoFollowAuthorization(tabId);
          return;
        }
        await clearAutoFollowBadge(tabId);
        const status = controller.status();
        if (status.state !== 'running' || status.tabId === tabId) return;
        try {
          const tab = await chrome.tabs.get(tabId);
          const response = await chrome.tabs.sendMessage(tabId, {
            type: 'MEDIA_PLAYBACK_STATUS',
          }) as MediaPlaybackResponse | undefined;
          if (tab.audible || response?.playing) await transferToTab(tabId);
        } catch {
          // A later play/audible event can retry while the grant remains.
        }
      }))
      .catch(() => undefined);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (
      changeInfo.status !== 'complete' &&
      changeInfo.audible !== true &&
      changeInfo.url === undefined
    ) return;
    void ready
      .then(() => enqueueLifecycle(async () => {
        const authorizedOrigin = authorizedTabs.get(tabId);
        if (authorizedOrigin && changeInfo.url !== undefined) {
          const nextOrigin = httpsOrigin(changeInfo.url);
          if (nextOrigin !== authorizedOrigin) {
            await revokeAuthorizedTab(tabId);
            await clearAutoFollowBadge(tabId);
          }
        }

        if (changeInfo.status === 'complete' && authorizedTabs.has(tabId)) {
          try {
            await chrome.scripting.executeScript({
              files: ['media-playback.js'],
              target: { allFrames: true, tabId },
            });
          } catch {
            await revokeAuthorizedTab(tabId);
          }
        }

        const status = controller.status();
        if (changeInfo.status === 'complete' && status.state === 'running' &&
          status.tabId === tabId) {
          try {
            await ensureTabContentScript(tabId);
            await controller.handleContentReady(tabId);
          } catch {
            // activeTab survives same-origin reloads but is revoked by a
            // cross-origin navigation. Failing closed also covers restricted
            // pages where Chrome refuses script injection.
            await controller.stop();
            await restoreBrowserFullscreenFallback(tabId);
            await chrome.storage.session.remove(activeSessionKey);
            await closeOffscreenIfUnused();
          }
          return;
        }

        if (changeInfo.audible === true && authorizedTabs.has(tabId)) {
          await transferToTab(tabId);
        } else if (changeInfo.audible === true) {
          await promptAutoFollowAuthorization(tabId);
        }
      }))
      .catch(() => undefined);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const next = normalizeSettings(
      (changes.settings.newValue as Partial<AppSettings> | undefined) ?? {},
    );
    controller.applyLayout({
      backgroundOpacity: next.backgroundOpacity,
      maxLineWidth: next.maxLineWidth,
      originalFontSize: next.originalFontSize,
      originalTextColor: next.originalTextColor,
      translationFontSize: next.translationFontSize,
      translationTextColor: next.translationTextColor,
    });
    void broadcastSidePanel().catch(() => undefined);
  });
});
