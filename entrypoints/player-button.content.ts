// The player button (ADR 0013), on every YouTube and Bilibili page: the one
// content script the manifest declares (scripts/verify-manifest.mjs).
import type { ExtensionMessage } from '../src/core/messages';
import { PlayerButton, type PlayerButtonApi, type PlayerButtonState } from '../src/content/player-button';
// Inlined: the page cannot load the extension's own files unless they are
// web-accessible, and the icon is not worth exposing to every page for.
import iconDataUrl from '../public/icon/48.png?inline';

const INSTALLED = '__bilingualPlayerButton';

export default defineContentScript({
  matches: ['https://www.youtube.com/*', 'https://www.bilibili.com/*'],
  runAt: 'document_idle',
  main() {
  const marker = window as Window & { [INSTALLED]?: boolean };
  // Injected again into an open tab when the extension reloads.
  if (marker[INSTALLED]) return;
  marker[INSTALLED] = true;

  let button: PlayerButton | undefined;
  const send = async <T>(message: ExtensionMessage): Promise<T> => {
    // Reloaded or updated: this copy can no longer reach the extension.
    if (!chrome.runtime?.id) {
      button?.stop();
      throw new Error('extension_context_invalidated');
    }
    return chrome.runtime.sendMessage(message) as Promise<T>;
  };

  const api: PlayerButtonApi = {
    iconUrl: () => iconDataUrl,
    async state() {
      const response = await send<{ ok?: boolean } & Partial<PlayerButtonState>>({
        target: 'background',
        type: 'PLAYER_BUTTON_STATE',
      });
      return {
        active: response?.active === true,
        mode: response?.mode === 'read-ahead' ? 'read-ahead' : 'live',
        targetLanguage: response?.targetLanguage ?? '',
      };
    },
    async toggle(on) {
      const response = await send<{ active?: boolean; error?: string; ok?: boolean }>({
        target: 'background',
        type: 'PLAYER_BUTTON_TOGGLE',
        payload: { on },
      });
      const error = response?.error;
      return {
        active: response?.active === true,
        ...(error === 'missing_keys' || error === 'model_missing' || error === 'needs_permission' ||
          error === 'needs_toolbar_grant'
          ? { error }
          : response?.ok ? {} : { error: 'start_failed' as const }),
      };
    },
    async setTargetLanguage(targetLanguage) {
      await send({ target: 'background', type: 'PLAYER_BUTTON_LANGUAGE', payload: { targetLanguage } });
    },
    async openSettings() {
      await send({ target: 'background', type: 'PLAYER_BUTTON_OPEN_SETTINGS' });
    },
    onActiveChange(listener) {
      chrome.runtime.onMessage.addListener((message: unknown, sender) => {
        if (sender.id !== chrome.runtime.id || sender.tab !== undefined) return false;
        const update = message as { payload?: { active?: unknown }; type?: unknown };
        if (update?.type === 'PLAYER_BUTTON_ACTIVE') listener(update.payload?.active === true);
        return false;
      });
    },
  };
  button = new PlayerButton(document, api);
  button.start();
  },
});
