import type { SessionStatus } from '../core/capture-session-controller';
import { t } from '../core/i18n';
import type { ExtensionMessage } from '../core/messages';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AppSettings,
} from '../core/settings';
import type { PopupApi } from './PopupApp';

interface SessionResponse {
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
  async loadSettings() {
    const stored = await chrome.storage.local.get('settings');
    return normalizeSettings(
      (stored.settings as Partial<AppSettings> | undefined) ?? DEFAULT_SETTINGS,
    );
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
};
