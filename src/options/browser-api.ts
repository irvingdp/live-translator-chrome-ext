import { chromeSitesApi } from '../core/chrome-sites-api';
import { allowedSites, disableSite } from '../core/read-ahead-sites';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AppSettings,
} from '../core/settings';

export interface ApiKeySettings {
  geminiApiKey: string;
  groqApiKey: string;
}

export interface OptionsApi {
  loadKeys(): Promise<ApiKeySettings>;
  saveKeys(keys: ApiKeySettings): Promise<void>;
  // Allowed sites for read-ahead (ADR 0009), as origins.
  listSites(): Promise<string[]>;
  removeSite(origin: string): Promise<void>;
}

async function loadSettings(): Promise<AppSettings> {
  const stored = await chrome.storage.local.get('settings');
  return normalizeSettings(
    (stored.settings as Partial<AppSettings> | undefined) ?? DEFAULT_SETTINGS,
  );
}

export const browserOptionsApi: OptionsApi = {
  async loadKeys() {
    const { geminiApiKey, groqApiKey } = await loadSettings();
    return { geminiApiKey, groqApiKey };
  },
  listSites: () => allowedSites(chromeSitesApi),
  removeSite: (origin) => disableSite(chromeSitesApi, origin),
  async saveKeys(keys) {
    const current = await loadSettings();
    const settings = normalizeSettings({ ...current, ...keys });
    await chrome.storage.local.set({ settings });
  },
};
