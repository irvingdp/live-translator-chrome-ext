import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AppSettings,
} from '../core/settings';

export interface ApiKeySettings {
  deepgramApiKey: string;
  deeplApiKey: string;
  geminiApiKey: string;
}

export interface OptionsApi {
  loadKeys(): Promise<ApiKeySettings>;
  saveKeys(keys: ApiKeySettings): Promise<void>;
}

async function loadSettings(): Promise<AppSettings> {
  const stored = await chrome.storage.local.get('settings');
  return normalizeSettings(
    (stored.settings as Partial<AppSettings> | undefined) ?? DEFAULT_SETTINGS,
  );
}

export const browserOptionsApi: OptionsApi = {
  async loadKeys() {
    const { deepgramApiKey, deeplApiKey, geminiApiKey } = await loadSettings();
    return { deepgramApiKey, deeplApiKey, geminiApiKey };
  },
  async saveKeys(keys) {
    const current = await loadSettings();
    const settings = normalizeSettings({ ...current, ...keys });
    await chrome.storage.local.set({ settings });
  },
};
