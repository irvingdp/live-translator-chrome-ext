import type { TabMessage } from '../src/core/capture-session-controller';
import { CaptionOverlay } from '../src/content/caption-overlay';

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

    chrome.runtime.onMessage.addListener((message: TabMessage, _sender, sendResponse) => {
      switch (message.type) {
        case 'CONTENT_PING':
          sendResponse({ ok: true });
          break;
        case 'OVERLAY_SHOW':
          overlay.show(message.payload);
          break;
        case 'OVERLAY_HIDE':
          overlay.hide();
          break;
        case 'CAPTION_ORIGINAL':
          overlay.setOriginal(
            message.payload.segmentId,
            message.payload.text,
          );
          break;
        case 'CAPTION_TRANSLATION':
          overlay.setTranslation(message.payload);
          break;
        case 'SESSION_ERROR':
          overlay.setSessionError(message.payload.code);
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
