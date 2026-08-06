import type { TabMessage } from '../src/core/capture-session-controller';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AppSettings,
} from '../src/core/settings';
import {
  CaptionOverlay,
  type CaptionAppearance,
} from '../src/content/caption-overlay';

export default defineContentScript({
  matches: ['https://*/*'],
  main() {
    const overlay = new CaptionOverlay(document);
    let frameRequested = false;
    const requestPosition = () => {
      if (frameRequested) return;
      frameRequested = true;
      requestAnimationFrame(() => {
        frameRequested = false;
        overlay.position();
      });
    };

    const observer = new MutationObserver(requestPosition);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', requestPosition);
    window.addEventListener('scroll', requestPosition, { passive: true });
    document.addEventListener('fullscreenchange', requestPosition);

    const readAppearance = async (): Promise<CaptionAppearance> => {
      const stored = await chrome.storage.local.get('settings');
      const settings = normalizeSettings(
        (stored.settings as Partial<AppSettings> | undefined) ??
          DEFAULT_SETTINGS,
      );
      return {
        backgroundOpacity: settings.backgroundOpacity,
        bottomOffset: settings.bottomOffset,
        maxLineWidth: settings.maxLineWidth,
        originalFontSize: settings.originalFontSize,
        translationFontSize: settings.translationFontSize,
      };
    };

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      void readAppearance().then((appearance) =>
        overlay.setAppearance(appearance),
      );
    });

    chrome.runtime.onMessage.addListener((message: TabMessage, _sender, sendResponse) => {
      switch (message.type) {
        case 'CONTENT_PING':
          sendResponse({ ok: true });
          break;
        case 'OVERLAY_SHOW':
          void readAppearance().then((appearance) => overlay.show(appearance));
          break;
        case 'OVERLAY_HIDE':
          overlay.hide();
          break;
        case 'CAPTION_WINDOW':
          overlay.setWindow(message.payload.pairs);
          break;
        case 'SESSION_ERROR':
          overlay.setSessionError(message.payload.code);
          break;
        case 'SESSION_ERROR_CLEAR':
          overlay.clearSessionError();
          break;
      }
      return false;
    });

    void chrome.runtime.sendMessage({
      target: 'background',
      type: 'CONTENT_READY',
    } satisfies import('../src/core/messages').ExtensionMessage);
  },
});
