import type { TabMessage } from '../src/core/capture-session-controller';
import { CaptionOverlay } from '../src/content/caption-overlay';

export default defineUnlistedScript(() => {
  const fullscreenDebugPrefix = '[Bilingual Captions][fullscreen-debug]';
  const placementDebugPrefix = '[Bilingual Captions][placement-debug]';
  const describeNode = (node: EventTarget | null): string => {
    if (node instanceof ShadowRoot) return '#shadow-root';
    if (!(node instanceof Element)) return node === document ? '#document' : String(node);
    const classes = [...node.classList].slice(0, 4).map((name) => `.${name}`).join('');
    const id = node.id ? `#${node.id}` : '';
    const label = node.getAttribute('aria-label') ?? node.getAttribute('title');
    return `${node.tagName.toLowerCase()}${id}${classes}${label ? `[label="${label}"]` : ''}`;
  };
  const debugState = (event?: Event) => {
    const host = document.querySelector<HTMLElement>('[data-bilingual-caption-root]');
    const captions = host?.shadowRoot?.querySelector<HTMLElement>('.captions');
    const toolbar = host?.shadowRoot?.querySelector<HTMLElement>('.caption-toolbar');
    const point = event && 'clientX' in event && 'clientY' in event
      ? { x: Number(event.clientX), y: Number(event.clientY) }
      : undefined;
    let elementsAtPoint: string[] = [];
    if (point && typeof document.elementsFromPoint === 'function') {
      elementsAtPoint = document.elementsFromPoint(point.x, point.y)
        .slice(0, 8)
        .map(describeNode);
    }
    const rect = captions?.getBoundingClientRect();
    const fullscreenRect = document.fullscreenElement instanceof Element
      ? document.fullscreenElement.getBoundingClientRect()
      : undefined;
    const visualViewport = window.visualViewport;
    return {
      captions: captions && rect
        ? {
            classes: [...captions.classList],
            pointerEvents: getComputedStyle(captions).pointerEvents,
            rect: {
              bottom: Math.round(rect.bottom),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              top: Math.round(rect.top),
            },
          }
        : undefined,
      defaultPrevented: event?.defaultPrevented,
      elementsAtPoint,
      eventPath: event?.composedPath().slice(0, 8).map(describeNode),
      fullscreenElement: describeNode(document.fullscreenElement),
      fullscreenEnabled: document.fullscreenEnabled,
      fullscreenRect: fullscreenRect
        ? {
            bottom: Math.round(fullscreenRect.bottom),
            height: Math.round(fullscreenRect.height),
            left: Math.round(fullscreenRect.left),
            right: Math.round(fullscreenRect.right),
            top: Math.round(fullscreenRect.top),
            width: Math.round(fullscreenRect.width),
          }
        : undefined,
      host: host
        ? {
            connected: host.isConnected,
            display: host.style.display,
            parent: describeNode(host.parentElement),
            pointerEvents: host.style.pointerEvents,
            visibility: host.style.visibility,
          }
        : undefined,
      point,
      target: event ? describeNode(event.target) : undefined,
      toolbarPointerEvents: toolbar
        ? getComputedStyle(toolbar).pointerEvents
        : undefined,
      type: event?.type,
      viewport: {
        devicePixelRatio: window.devicePixelRatio,
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
        outerHeight: window.outerHeight,
        outerWidth: window.outerWidth,
        screenAvailHeight: window.screen.availHeight,
        screenAvailWidth: window.screen.availWidth,
        screenHeight: window.screen.height,
        screenWidth: window.screen.width,
        visualHeight: visualViewport?.height,
        visualWidth: visualViewport?.width,
      },
    };
  };
  const isFullscreenControl = (event: Event) =>
    event.target instanceof Element &&
    Boolean(event.target.closest('.ytp-fullscreen-button'));
  let fullscreenResumeTimer: number | undefined;
  let browserFullscreenFallbackActive = false;
  const setBrowserFullscreenFallback = (active: boolean) => {
    if (browserFullscreenFallbackActive === active) return;
    browserFullscreenFallbackActive = active;
    void chrome.runtime.sendMessage({
      target: 'background',
      type: 'BROWSER_FULLSCREEN_FALLBACK',
      payload: { active },
    } satisfies import('../src/core/messages').ExtensionMessage).then(
      (response) => console.info(
        fullscreenDebugPrefix,
        'browser fullscreen fallback',
        { active, response },
      ),
      (error: unknown) => console.error(
        fullscreenDebugPrefix,
        'browser fullscreen fallback failed',
        { active, error: String(error) },
      ),
    );
  };
  const resumeOverlayAfterFullscreenTransition = () => {
    if (fullscreenResumeTimer !== undefined) {
      window.clearTimeout(fullscreenResumeTimer);
    }
    fullscreenResumeTimer = window.setTimeout(() => {
      fullscreenResumeTimer = undefined;
      overlay.resumeAfterFullscreenTransition();
      requestPosition();
      requestAnimationFrame(() => {
        console.info(fullscreenDebugPrefix, 'after transition resume', debugState());
      });
    }, 350);
  };
  const logPointerDebug = (event: Event) => {
    console.info(fullscreenDebugPrefix, 'pointer event', debugState(event));
    if (event.type === 'click' && isFullscreenControl(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const fullscreenOperation = document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      void fullscreenOperation.catch((error: unknown) => {
        console.error(
          fullscreenDebugPrefix,
          'immersive fullscreen request failed',
          { error: String(error), state: debugState(event) },
        );
        resumeOverlayAfterFullscreenTransition();
      });
      return;
    }
    if (event.type !== 'pointerdown' || !isFullscreenControl(event)) return;
    overlay.suspendForFullscreenTransition();
    console.info(fullscreenDebugPrefix, 'overlay detached for transition', debugState(event));
    if (fullscreenResumeTimer !== undefined) {
      window.clearTimeout(fullscreenResumeTimer);
    }
    fullscreenResumeTimer = window.setTimeout(() => {
      fullscreenResumeTimer = undefined;
      overlay.resumeAfterFullscreenTransition();
      requestPosition();
    }, 1500);
  };
  const handleFullscreenChange = (event: Event) => {
    console.info(fullscreenDebugPrefix, 'fullscreenchange', debugState(event));
    setBrowserFullscreenFallback(document.fullscreenElement !== null);
    resumeOverlayAfterFullscreenTransition();
  };
  const handleFullscreenError = (event: Event) => {
    console.error(fullscreenDebugPrefix, 'fullscreenerror', debugState(event));
  };
  const overlay = new CaptionOverlay(document, {
    onClear() {
      return chrome.runtime.sendMessage({
        target: 'background',
        type: 'CLEAR_CAPTIONS',
      } satisfies import('../src/core/messages').ExtensionMessage).then(() => undefined);
    },
    onAppearanceChanged(appearance) {
      void chrome.runtime.sendMessage({
        target: 'background',
        type: 'OVERLAY_APPEARANCE_CHANGED',
        payload: { appearance },
      } satisfies import('../src/core/messages').ExtensionMessage);
    },
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
    document.addEventListener('click', logPointerDebug, true);
    document.addEventListener('pointerdown', logPointerDebug, true);
    document.addEventListener('pointerup', logPointerDebug, true);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('fullscreenerror', handleFullscreenError);
    console.info(fullscreenDebugPrefix, 'debug listeners started', debugState());
  };

  const stopPositioning = () => {
    observer?.disconnect();
    observer = undefined;
    window.removeEventListener('resize', requestPosition);
    window.removeEventListener('scroll', requestPosition);
    document.removeEventListener('click', logPointerDebug, true);
    document.removeEventListener('pointerdown', logPointerDebug, true);
    document.removeEventListener('pointerup', logPointerDebug, true);
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    document.removeEventListener('fullscreenerror', handleFullscreenError);
    if (fullscreenResumeTimer !== undefined) {
      window.clearTimeout(fullscreenResumeTimer);
      fullscreenResumeTimer = undefined;
    }
    overlay.resumeAfterFullscreenTransition();
    setBrowserFullscreenFallback(false);
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
          console.info(placementDebugPrefix, 'overlay show received', {
            hasSavedLayout: tabMessage.payload.layout !== undefined,
            placement: tabMessage.payload.placement,
          });
          overlay.show(
            tabMessage.payload.appearance,
            tabMessage.payload.layout,
            tabMessage.payload.placement,
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
