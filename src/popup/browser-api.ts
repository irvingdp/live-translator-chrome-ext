import type { SessionStatus } from '../core/capture-session-controller';
import { sendFeedback } from '../core/feedback';
import { t } from '../core/i18n';
import { normalizeRatingPrompt, RATING_PROMPT_KEY } from '../core/rating-prompt';
import type { ExtensionMessage, LocalWhisperDownload } from '../core/messages';
import {
  DEEPGRAM_REMOVED_NOTICE_KEY,
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AppSettings,
} from '../core/settings';
import { chromeLanguageCode, type TranslatorApi } from '../read-ahead/chrome-translation';
import { GROQ_ORIGIN } from '../read-ahead/groq-transcription';
import { WEB_TRANSLATION_ORIGINS } from '../read-ahead/web-translation';
import {
  LOCAL_WHISPER_CACHE,
  LOCAL_WHISPER_DOWNLOAD_KEY,
  isModelCached,
  modelCacheUrls,
} from '../read-ahead/local-whisper';
import type { PopupApi } from './PopupApp';
import { chromeSitesApi } from '../core/chrome-sites-api';
import { enableSite, siteOrigin, sitePattern } from '../core/read-ahead-sites';

function translatorApi(): TranslatorApi | undefined {
  return (globalThis as { Translator?: TranslatorApi }).Translator;
}

interface SessionResponse {
  authorized?: boolean;
  error?: string;
  ok: boolean;
  status?: SessionStatus;
}

async function control(message: ExtensionMessage): Promise<SessionStatus> {
  const response = (await chrome.runtime.sendMessage(message)) as SessionResponse;
  if (!response?.ok || !response.status) {
    throw new Error(response?.error ?? t('backgroundNoResponse'));
  }
  return response.status;
}

export const browserPopupApi: PopupApi = {
  async chromeTranslatorStatus(sourceLanguage, targetLanguage) {
    const api = translatorApi();
    if (!api) return 'unsupported';
    const availability = await api.availability({
      sourceLanguage: chromeLanguageCode(sourceLanguage),
      targetLanguage: chromeLanguageCode(targetLanguage),
    });
    return availability === 'downloading' ? 'downloadable' : availability;
  },
  async prepareChromeTranslator(sourceLanguage, targetLanguage) {
    await translatorApi()?.create({
      sourceLanguage: chromeLanguageCode(sourceLanguage),
      targetLanguage: chromeLanguageCode(targetLanguage),
    });
  },
  // One prompt for the Whisper service and the web translation it may fall
  // back to (asked for here, since the fallback happens without a gesture).
  // Local Whisper reaches no service, only the fallback; its model comes from
  // Hugging Face, which allows any origin to fetch it.
  requestPermission: (service) => chrome.permissions.request({
    origins: service === 'local' ? [...WEB_TRANSLATION_ORIGINS] : [GROQ_ORIGIN, ...WEB_TRANSLATION_ORIGINS],
  }),
  async webGpuAvailable() {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return Boolean(await gpu?.requestAdapter().catch(() => null));
  },
  async localWhisperCached(model) {
    const cache = await caches.open(LOCAL_WHISPER_CACHE);
    return isModelCached(model, (await cache.keys()).map((request) => request.url));
  },
  async downloadLocalWhisper(model) {
    const response = await chrome.runtime.sendMessage({
      target: 'background',
      type: 'LOCAL_WHISPER_DOWNLOAD',
      payload: { model },
    } satisfies ExtensionMessage) as { error?: string; ok?: boolean } | undefined;
    if (!response?.ok) throw new Error(response?.error ?? t('backgroundNoResponse'));
  },
  async deleteLocalWhisper(model) {
    const cache = await caches.open(LOCAL_WHISPER_CACHE);
    const urls = modelCacheUrls(model, (await cache.keys()).map((request) => request.url));
    await Promise.all(urls.map((url) => cache.delete(url)));
    await chrome.storage.session.remove(LOCAL_WHISPER_DOWNLOAD_KEY);
  },
  watchLocalWhisperDownload(onChange) {
    void chrome.storage.session.get(LOCAL_WHISPER_DOWNLOAD_KEY)
      .then((stored) => onChange(stored[LOCAL_WHISPER_DOWNLOAD_KEY] as LocalWhisperDownload | undefined));
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && LOCAL_WHISPER_DOWNLOAD_KEY in changes) {
        onChange(changes[LOCAL_WHISPER_DOWNLOAD_KEY]!.newValue as LocalWhisperDownload | undefined);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  },
  async currentSite() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const origin = siteOrigin(tab?.url);
    return tab?.id !== undefined && origin ? { origin, tabId: tab.id } : undefined;
  },
  async allowSite({ origin, tabId }) {
    const granted = await chrome.permissions.request({ origins: [sitePattern(origin)] });
    if (!granted) return false;
    await enableSite(chromeSitesApi, origin);
    // The tap only arrives with a fresh page; read-ahead resumes after it.
    await chrome.tabs.reload(tabId);
    return true;
  },
  async authorizeCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return undefined;
    const response = await chrome.runtime.sendMessage({
      target: 'background',
      type: 'SESSION_AUTHORIZE_TAB',
      payload: { tabId: tab.id },
    } satisfies ExtensionMessage) as SessionResponse;
    if (!response?.ok) {
      throw new Error(response?.error ?? t('backgroundNoResponse'));
    }
    return { authorized: response.authorized === true, tabId: tab.id };
  },
  extensionVersion: () => chrome.runtime.getManifest().version,
  async loadRatingPrompt() {
    const stored = await chrome.storage.local.get(RATING_PROMPT_KEY);
    return normalizeRatingPrompt(stored[RATING_PROMPT_KEY]);
  },
  async saveRatingPrompt(state) {
    await chrome.storage.local.set({ [RATING_PROMPT_KEY]: state });
  },
  sendFeedback: (payload) => sendFeedback(payload),
  async loadSettings() {
    const stored = (await chrome.storage.local.get('settings')).settings as Partial<AppSettings> | undefined;
    return normalizeSettings(stored ?? DEFAULT_SETTINGS);
  },
  async saveSettings(settings) {
    await chrome.storage.local.set({ settings });
  },
  async start(settings) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || !tab.url?.startsWith('https://')) {
      throw new Error(t('needHttpsTab'));
    }
    return control({
      target: 'background',
      type: 'SESSION_START',
      payload: { settings, tabId: tab.id },
    });
  },
  status: () => control({ target: 'background', type: 'SESSION_STATUS' }),
  stop: () => control({ target: 'background', type: 'SESSION_STOP' }),
  async takeDeepgramRemovedNotice() {
    const stored = await chrome.storage.local.get(DEEPGRAM_REMOVED_NOTICE_KEY);
    if (stored[DEEPGRAM_REMOVED_NOTICE_KEY] !== true) return false;
    await chrome.storage.local.remove(DEEPGRAM_REMOVED_NOTICE_KEY);
    return true;
  },
};
