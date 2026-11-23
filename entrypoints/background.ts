import { CaptureSessionController } from '../src/core/capture-session-controller';
import { ensureContentScript } from '../src/core/content-script-loader';
import {
  isExtensionPage,
  isMessageEnvelope,
  isTopFrameContentScript,
} from '../src/core/message-security';
import type { ExtensionMessage, LocalWhisperDownload } from '../src/core/messages';
import type { ChunkSentence } from '../src/read-ahead/gemini-chunk-translation';
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
  requiredApiKeys,
  validateSettingsForStart,
  type AppSettings,
} from '../src/core/settings';
import type { PlayerButtonError } from '../src/content/player-button';
import { redactSessionSnapshot } from '../src/core/session-persistence';
import {
  ReadAheadChunkError,
} from '../src/core/capture-session-controller';
import {
  CHUNK_REQUEST_TIMEOUT_MS,
  ChunkTranslationError,
  translateChunk,
  withRequestTimeout,
} from '../src/read-ahead/gemini-chunk-translation';
import { translateOnWeb } from '../src/read-ahead/web-translation';
import { translateWithGroq } from '../src/read-ahead/groq-translation';
import {
  GROQ_ORIGIN,
  transcribeChunk,
} from '../src/read-ahead/groq-transcription';
import {
  LOCAL_WHISPER_CACHE,
  LOCAL_WHISPER_DOWNLOAD_KEY,
  LOCAL_WHISPER_SPECS,
  downloadInProgress,
  isModelCached,
  type LocalWhisperModel,
} from '../src/read-ahead/local-whisper';
import { t } from '../src/core/i18n';
import { isSiteAllowed, siteOrigin, syncSites } from '../src/core/read-ahead-sites';
import { chromeSitesApi } from '../src/core/chrome-sites-api';

const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'm.youtube.com', 'youtube.com']);

const sitesApi = chromeSitesApi;

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
  function switchReadAheadRecognizer(
    tabId: number,
    recognizer: 'groq' | 'local',
  ): Promise<{ ok: true; switched: boolean }> {
    return restartReadAhead(tabId, { readAheadRecognizer: recognizer });
  }

  // Saves `change` and restarts the running read-ahead session with it from
  // where the viewer is; or, when its recognizer is not set up, stops and
  // opens the popup on it.
  async function restartReadAhead(
    tabId: number,
    change: Partial<AppSettings>,
  ): Promise<{ ok: true; switched: boolean }> {
    const status = controller.status();
    const stored = await chrome.storage.local.get('settings');
    const settings = normalizeSettings((stored.settings as Partial<AppSettings> | undefined) ?? {});
    if (status.state !== 'running' || status.tabId !== tabId || settings.transcriber !== 'gemini-read-ahead') {
      return { ok: true, switched: false };
    }
    const next = normalizeSettings({ ...settings, ...change });
    const recognizer = next.readAheadRecognizer;
    // Gemini needs its key; Groq its key and permission; Local Whisper its
    // downloaded model.
    const groqReady = async () => next.groqApiKey.trim() !== '' && await chrome.permissions.contains({
      origins: [GROQ_ORIGIN],
    }).catch(() => false);
    // Groq (Qwen) as the translator needs the Groq key and permission too.
    const ready = recognizer === 'local'
      ? isModelCached(next.localWhisperModel, await cachedModelUrls().catch(() => [])) &&
        (next.readAheadTranslator !== 'groq' || await groqReady())
      : recognizer === 'gemini'
        ? next.geminiApiKey.trim() !== ''
        : await groqReady();
    await chrome.storage.local.set({ settings: next });
    if (!ready) {
      await stopSession();
      await chrome.action.openPopup().catch(() => chrome.runtime.openOptionsPage());
      return { ok: true, switched: false };
    }
    if (recognizer === 'local') await prepareLocalWhisper(next.localWhisperModel);
    await controller.start(tabId, next);
    await persistActiveSession();
    return { ok: true, switched: true };
  }

  async function storedSettings(): Promise<AppSettings> {
    const stored = await chrome.storage.local.get('settings');
    return normalizeSettings((stored.settings as Partial<AppSettings> | undefined) ?? {});
  }

  // Starts captions the way the popup's switch does. Callers hold the
  // lifecycle.
  async function startSession(tabId: number, settings: AppSettings): Promise<void> {
    try {
      const savedLayout = await getOverlayLayout(tabId);
      if (savedLayout?.mode === 'native') {
        await persistOverlayLayout(tabId, { ...savedLayout, mode: 'floating' });
      }
      if (settings.transcriber === 'gemini-read-ahead' && settings.readAheadRecognizer === 'local') {
        await prepareLocalWhisper(settings.localWhisperModel);
      }
      await controller.start(tabId, settings);
      if (!authorizedTabs.has(tabId)) {
        await authorizeTab(tabId).catch(() => false);
      }
    } catch (error) {
      await chrome.storage.session.remove(activeSessionKey);
      await closeOffscreenIfUnused();
      throw error;
    }
    await persistActiveSession();
  }

  // The tab whose captions the player button there shows as on.
  function playerButtonTab(): number | undefined {
    const status = controller.status();
    return status.state === 'running' || status.state === 'starting' ? status.tabId : undefined;
  }

  // What the chosen mode still needs before the player button can start it:
  // the popup is where keys are typed, permissions asked and models
  // downloaded.
  async function startBlocker(settings: AppSettings): Promise<PlayerButtonError | undefined> {
    if (Object.keys(validateSettingsForStart(settings)).length > 0) return 'missing_keys';
    if (settings.transcriber !== 'gemini-read-ahead') return undefined;
    if (
      requiredApiKeys(settings).includes('groqApiKey') &&
      !await chrome.permissions.contains({ origins: [GROQ_ORIGIN] }).catch(() => false)
    ) {
      return 'needs_permission';
    }
    if (
      settings.readAheadRecognizer === 'local' &&
      !isModelCached(settings.localWhisperModel, await cachedModelUrls().catch(() => []))
    ) {
      return 'model_missing';
    }
    return undefined;
  }

  // The player button's switch (ADR 0013), in the mode chosen in the popup.
  // Live mode's tab capture works only in a tab the viewer once opened the
  // extension's own button on; elsewhere it fails, and the menu says so.
  async function togglePlayerButton(
    tabId: number,
    on: boolean,
  ): Promise<{ active: boolean; error?: PlayerButtonError; ok: boolean }> {
    if (!on) {
      if (playerButtonTab() === tabId) await stopSession();
      return { active: false, ok: true };
    }
    if (playerButtonTab() === tabId) return { active: true, ok: true };
    const settings = await storedSettings();
    const blocker = await startBlocker(settings);
    if (blocker) return { active: false, error: blocker, ok: false };
    const granted = authorizedTabs.has(tabId);
    try {
      await startSession(tabId, settings);
    } catch {
      const live = settings.transcriber !== 'gemini-read-ahead';
      return { active: false, error: live && !granted ? 'needs_toolbar_grant' : 'start_failed', ok: false };
    }
    return { active: playerButtonTab() === tabId, ok: true };
  }

  // Tells the player buttons when captions start or stop in their tab.
  let notifiedPlayerTab: number | undefined;
  async function notifyPlayerButtons(): Promise<void> {
    const tabId = playerButtonTab();
    if (tabId === notifiedPlayerTab) return;
    const previous = notifiedPlayerTab;
    notifiedPlayerTab = tabId;
    for (const [id, active] of [[previous, false], [tabId, true]] as const) {
      if (id === undefined) continue;
      await chrome.tabs.sendMessage(id, { type: 'PLAYER_BUTTON_ACTIVE', payload: { active } })
        .catch(() => undefined);
    }
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
      await createOffscreen();
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
      // MediaSource; everything else stays in the isolated world. An allowed
      // site already has the MediaSource tap from page load (ADR 0009), so
      // YouTube's own tap is only for YouTube not allowed.
      const allowed = await isSiteAllowed(sitesApi, siteOrigin(tab.url) ?? '').catch(() => false);
      if (YOUTUBE_HOSTS.has(host) && !allowed) {
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
    translateWithGroq: (request, timeoutMs) => translateWithGroq(request, undefined, timeoutMs),
    // WebGPU is exposed to the service worker too (Chrome 124+).
    localWhisperUsable: async () => {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      return Boolean(await gpu?.requestAdapter().catch(() => null));
    },
    transcribeChunk: async (request) => {
      if (request.provider === 'groq') {
        const { provider: _provider, ...groq } = request;
        return transcribeChunk(groq);
      }
      // Local Whisper, in the offscreen document (issue #15).
      const { provider: _provider, ...local } = request;
      await createOffscreen();
      const response = await withRequestTimeout(() => chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'LOCAL_WHISPER_TRANSCRIBE',
        payload: local,
      } satisfies ExtensionMessage) as Promise<{ error?: string; ok?: boolean; sentences?: ChunkSentence[] }>,
      CHUNK_REQUEST_TIMEOUT_MS);
      if (!response?.ok || !Array.isArray(response.sentences)) {
        throw new ChunkTranslationError(
          response?.error === 'timeout' ? 'timeout' : 'provider_unavailable',
        );
      }
      return { sentences: response.sentences };
    },
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
        ...(controller.playbackClock() ? { clock: controller.playbackClock() } : {}),
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

  // The one offscreen document serves both live capture and Local Whisper.
  async function createOffscreen(): Promise<void> {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    });
    if (existing.length > 0) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.WORKERS],
      justification:
        'Capture the audio of the tab the user selected to produce live captions, ' +
        'and run the speech recognition model the user downloaded on this computer',
    });
  }

  async function cachedModelUrls(): Promise<string[]> {
    const cache = await caches.open(LOCAL_WHISPER_CACHE);
    return (await cache.keys()).map((request) => request.url);
  }

  // Before a read-ahead session on Local Whisper: its model must already be
  // downloaded (the popup does that, after the viewer agreed to its size), and
  // is loaded onto the GPU now, so the first chunks do not wait for it.
  async function prepareLocalWhisper(model: LocalWhisperModel): Promise<void> {
    if (!isModelCached(model, await cachedModelUrls())) {
      throw new Error(t('localWhisperModelMissing'));
    }
    await createOffscreen();
    await sendToOffscreen({
      target: 'offscreen',
      type: 'LOCAL_WHISPER_LOAD',
      payload: { download: false, model },
    });
  }

  async function storedDownload(): Promise<LocalWhisperDownload | undefined> {
    const stored = await chrome.storage.session.get(LOCAL_WHISPER_DOWNLOAD_KEY);
    return stored[LOCAL_WHISPER_DOWNLOAD_KEY] as LocalWhisperDownload | undefined;
  }

  // Starts a model download in the offscreen document. The download, not this
  // worker, owns it: its progress and end arrive as LOCAL_WHISPER_PROGRESS,
  // and the state lives in chrome.storage.session, so a restarted worker
  // still reports it.
  async function downloadLocalWhisper(model: LocalWhisperModel): Promise<void> {
    if (downloadInProgress(await storedDownload(), Date.now())) return;
    const totalMB = LOCAL_WHISPER_SPECS[model].downloadMB;
    await chrome.storage.session.set({
      [LOCAL_WHISPER_DOWNLOAD_KEY]: {
        loadedMB: 0, model, state: 'downloading', totalMB, updatedAt: Date.now(),
      } satisfies LocalWhisperDownload,
    });
    try {
      await createOffscreen();
      await sendToOffscreen({
        target: 'offscreen',
        type: 'LOCAL_WHISPER_LOAD',
        payload: { download: true, model },
      });
    } catch (error) {
      await acceptDownloadProgress({
        error: error instanceof Error ? error.message : String(error),
        loadedMB: 0, model, state: 'failed', totalMB,
      });
    }
  }

  async function acceptDownloadProgress(
    progress: Omit<LocalWhisperDownload, 'updatedAt'>,
  ): Promise<void> {
    const totalMB = LOCAL_WHISPER_SPECS[progress.model].downloadMB;
    const download: LocalWhisperDownload = progress.state === 'done'
      ? { ...progress, loadedMB: totalMB, totalMB, updatedAt: Date.now() }
      : { ...progress, totalMB: progress.totalMB || totalMB, updatedAt: Date.now() };
    await chrome.storage.session.set({ [LOCAL_WHISPER_DOWNLOAD_KEY]: download });
    if (download.state === 'downloading' || controller.snapshot()) return;
    // Downloaded for later: free the GPU unless a session is using it.
    await sendToOffscreen({ target: 'offscreen', type: 'LOCAL_WHISPER_UNLOAD' }).catch(() => undefined);
    await closeOffscreenIfUnused();
  }

  async function closeOffscreenIfUnused(): Promise<void> {
    if (controller.snapshot()) return;
    if (downloadInProgress(await storedDownload(), Date.now())) return;
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

  // Allowed sites whose permission the viewer took away elsewhere lose their
  // registration (ADR 0009).
  void syncSites(sitesApi).catch(() => undefined);
  chrome.permissions.onRemoved?.addListener(() => void syncSites(sitesApi).catch(() => undefined));

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
    'LOCAL_WHISPER_PROGRESS',
    'CAPTURE_DISCONNECTED',
    'CAPTURE_KEEPALIVE',
  ]);
  const popupMessageTypes = new Set([
    'LOCAL_WHISPER_DOWNLOAD',
    'SESSION_AUTHORIZE_TAB',
    'SESSION_START',
    'SESSION_STATUS',
    'SESSION_STOP',
  ]);
  const contentMessageTypes = new Set([
    'PLAYER_BUTTON_LANGUAGE',
    'PLAYER_BUTTON_OPEN_SETTINGS',
    'PLAYER_BUTTON_STATE',
    'PLAYER_BUTTON_TOGGLE',
    'READ_AHEAD_CUE',
    'READ_AHEAD_STATUS',
    'READ_AHEAD_SWITCH_RECOGNIZER',
    'READ_AHEAD_USE_RECOGNIZER',
    'READ_AHEAD_OPEN_SITE_ACCESS',
    'READ_AHEAD_CLOCK',
    'READ_AHEAD_TRANSLATE',
    'READ_AHEAD_WEB_TRANSLATE',
    'READ_AHEAD_GROQ_TRANSLATE',
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
            if (recognizer !== 'groq' && recognizer !== 'local') {
              return { error: 'unsupported_recognizer', ok: false };
            }
            return enqueueLifecycle(() => switchReadAheadRecognizer(tabId, recognizer));
          }
          case 'READ_AHEAD_CLOCK': {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return { error: 'missing_tab', ok: false };
            const { clock, sessionId } = message.payload;
            if (![clock?.at, clock?.rate, clock?.time].every((value) => Number.isFinite(value))) {
              return { error: 'invalid_request', ok: false };
            }
            controller.acceptReadAheadClock(sessionId, tabId, {
              at: clock.at, paused: Boolean(clock.paused), rate: clock.rate, time: clock.time,
            });
            return { ok: true };
          }
          // The "允許這個網站" button: allowing is asked for in the popup,
          // the only place Chrome lets it be asked (ADR 0009).
          case 'READ_AHEAD_OPEN_SITE_ACCESS':
            await chrome.action.openPopup().catch(() => chrome.runtime.openOptionsPage());
            return { ok: true };
          case 'READ_AHEAD_USE_RECOGNIZER': {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return { error: 'missing_tab', ok: false };
            return enqueueLifecycle(() => restartReadAhead(tabId, { preferCaptionTracks: false }));
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
          case 'READ_AHEAD_GROQ_TRANSLATE': {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return { error: 'missing_tab', ok: false };
            const { context, sessionId, sourceLanguage, targetLanguage, texts, timeoutMs } = message.payload;
            if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string')) {
              return { error: 'invalid_request', ok: false };
            }
            const pairs = Array.isArray(context)
              ? context.filter((item) =>
                typeof item?.original === 'string' && typeof item.translation === 'string')
              : [];
            try {
              const translations = await controller.translateReadAheadWithGroq(
                sessionId,
                tabId,
                {
                  context: pairs.map(({ original, translation }) => ({ original, translation })),
                  ...(sourceLanguage ? { sourceLanguage } : {}),
                  targetLanguage,
                  texts,
                },
                // The page's allowance, never more than one request's.
                Math.min(CHUNK_REQUEST_TIMEOUT_MS, Math.max(500, Number(timeoutMs) || 0)),
              );
              return { ok: true, translations };
            } catch (error) {
              const detail = (error as { detail?: unknown } | null)?.detail;
              return {
                error: error instanceof ChunkTranslationError ? error.code
                  : error instanceof Error ? error.message : 'unknown_error',
                ...(typeof detail === 'string' ? { detail } : {}),
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
              await startSession(message.payload.tabId, normalizeSettings(message.payload.settings));
              return { ok: true, status: controller.status() };
            });
          case 'PLAYER_BUTTON_STATE': {
            const settings = await storedSettings();
            return {
              active: playerButtonTab() === sender.tab?.id,
              mode: settings.transcriber === 'gemini-read-ahead' ? 'read-ahead' : 'live',
              ok: true,
              targetLanguage: settings.geminiTargetLanguage,
            };
          }
          case 'PLAYER_BUTTON_TOGGLE': {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return { error: 'missing_tab', ok: false };
            return enqueueLifecycle(() => togglePlayerButton(tabId, message.payload.on));
          }
          case 'PLAYER_BUTTON_LANGUAGE': {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return { error: 'missing_tab', ok: false };
            const targetLanguage = normalizeSettings({ geminiTargetLanguage: message.payload.targetLanguage })
              .geminiTargetLanguage;
            return enqueueLifecycle(async () => {
              const switched = await restartReadAhead(tabId, { geminiTargetLanguage: targetLanguage });
              // Not running here: the choice is only saved.
              if (!switched.switched) {
                await chrome.storage.local.set({
                  settings: { ...await storedSettings(), geminiTargetLanguage: targetLanguage },
                });
              }
              return { ok: true };
            });
          }
          case 'PLAYER_BUTTON_OPEN_SETTINGS':
            await chrome.action.openPopup().catch(() => chrome.runtime.openOptionsPage());
            return { ok: true };
          case 'LOCAL_WHISPER_DOWNLOAD': {
            const { model } = message.payload;
            if (!(model in LOCAL_WHISPER_SPECS)) return { error: 'unknown_model', ok: false };
            // Answered at once: the popup may close long before it is done.
            void downloadLocalWhisper(model);
            return { ok: true };
          }
          case 'LOCAL_WHISPER_PROGRESS':
            await acceptDownloadProgress(message.payload);
            return { ok: true };
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
          await notifyPlayerButtons().catch(() => undefined);
          sendResponse(response);
        },
        (error: unknown) => {
          void broadcastSidePanel();
          void notifyPlayerButtons().catch(() => undefined);
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
