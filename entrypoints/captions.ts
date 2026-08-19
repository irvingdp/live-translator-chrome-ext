import type { TabMessage } from '../src/core/capture-session-controller';
import { CaptionOverlay } from '../src/content/caption-overlay';

export default defineUnlistedScript(() => {
  const overlay = new CaptionOverlay(document, {
    onLayoutChanged(layout) {
      void chrome.runtime.sendMessage({
        target: 'background',
        type: 'OVERLAY_LAYOUT_CHANGED',
        payload: { layout },
      } satisfies import('../src/core/messages').ExtensionMessage);
    },
    async onOpenSidePanel(layout) {
      const response = await chrome.runtime.sendMessage({
        target: 'background',
        type: 'OPEN_SIDE_PANEL',
        payload: { layout },
      } satisfies import('../src/core/messages').ExtensionMessage) as {
        error?: string;
        ok?: boolean;
      };
      if (!response?.ok) throw new Error(response?.error ?? 'side_panel_failed');
    },
  });
  let frameId: number | undefined;
  let observer: MutationObserver | undefined;

  const requestPosition = () => {
    if (frameId !== undefined) return;
    frameId = requestAnimationFrame(() => {
      frameId = undefined;
      overlay.position();
    });
  };

  const startPositioning = () => {
    if (observer) return;
    observer = new MutationObserver(requestPosition);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    window.addEventListener('resize', requestPosition);
    window.addEventListener('scroll', requestPosition, { passive: true });
    document.addEventListener('fullscreenchange', requestPosition);
  };

  const stopPositioning = () => {
    observer?.disconnect();
    observer = undefined;
    window.removeEventListener('resize', requestPosition);
    window.removeEventListener('scroll', requestPosition);
    document.removeEventListener('fullscreenchange', requestPosition);
    if (frameId !== undefined) cancelAnimationFrame(frameId);
    frameId = undefined;
  };

  chrome.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
      if (
        sender.id !== chrome.runtime.id ||
        sender.tab !== undefined ||
        !message ||
        typeof message !== 'object' ||
        !('type' in message)
      ) {
        return false;
      }
      const tabMessage = message as TabMessage;
      switch (tabMessage.type) {
        case 'CONTENT_PING':
          sendResponse({ ok: true });
          break;
        case 'OVERLAY_SHOW':
          startPositioning();
          overlay.show(
            tabMessage.payload.appearance,
            tabMessage.payload.layout,
          );
          break;
        case 'OVERLAY_APPEARANCE':
          overlay.setAppearance(tabMessage.payload.appearance);
          break;
        case 'OVERLAY_LAYOUT':
          overlay.setLayout(tabMessage.payload.layout);
          break;
        case 'OVERLAY_HIDE':
          stopPositioning();
          overlay.hide();
          break;
        case 'CAPTION_WINDOW':
          overlay.setWindow(tabMessage.payload.pairs);
          break;
        case 'SESSION_ERROR':
          overlay.setSessionError(tabMessage.payload.code);
          break;
        case 'SESSION_ERROR_CLEAR':
          overlay.clearSessionError();
          break;
      }
      return false;
    },
  );

  void chrome.runtime.sendMessage({
    target: 'background',
    type: 'CONTENT_READY',
  } satisfies import('../src/core/messages').ExtensionMessage);
});
