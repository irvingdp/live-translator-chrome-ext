import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TabMessage } from '../../src/core/capture-session-controller';
import type { CaptionAppearance } from '../../src/core/settings';

const overlay = vi.hoisted(() => ({
  clearSessionError: vi.fn(),
  hide: vi.fn(),
  position: vi.fn(),
  setAppearance: vi.fn(),
  setLayout: vi.fn(),
  setSessionError: vi.fn(),
  setWindow: vi.fn(),
  show: vi.fn(),
  resumeAfterFullscreenTransition: vi.fn(),
  suspendForFullscreenTransition: vi.fn(),
}));

vi.mock('../../src/content/caption-overlay', () => ({
  CaptionOverlay: class {
    clearSessionError = overlay.clearSessionError;
    hide = overlay.hide;
    position = overlay.position;
    setAppearance = overlay.setAppearance;
    setLayout = overlay.setLayout;
    setSessionError = overlay.setSessionError;
    setWindow = overlay.setWindow;
    show = overlay.show;
    resumeAfterFullscreenTransition = overlay.resumeAfterFullscreenTransition;
    suspendForFullscreenTransition = overlay.suspendForFullscreenTransition;
  },
}));

const appearance: CaptionAppearance = {
  backgroundOpacity: 50,
  originalFontSize: 24,
  originalTextColor: '#ffffff',
  translationFontSize: 22,
  translationTextColor: '#fde68a',
};

type ContentListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

let listener: ContentListener;
let disconnectObserver: ReturnType<typeof vi.fn>;
let observe: ReturnType<typeof vi.fn>;
let runtimeSendMessage: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  for (const mock of Object.values(overlay)) mock.mockReset();
  disconnectObserver = vi.fn();
  observe = vi.fn();
  runtimeSendMessage = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    value: null,
  });

  vi.stubGlobal('defineUnlistedScript', (register: () => void) => register());
  vi.stubGlobal(
    'MutationObserver',
    class {
      disconnect = disconnectObserver;
      observe = observe;
    },
  );
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test',
      onMessage: {
        addListener: vi.fn((registered: ContentListener) => {
          listener = registered;
        }),
      },
      sendMessage: runtimeSendMessage,
    },
  });

  await import('../../entrypoints/captions');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('captions unlisted entrypoint', () => {
  it('starts with only a message receiver and no page observer or storage access', () => {
    expect(observe).not.toHaveBeenCalled();
    expect(runtimeSendMessage).toHaveBeenCalledWith({
      target: 'background',
      type: 'CONTENT_READY',
    });
    expect((chrome as unknown as { storage?: unknown }).storage).toBeUndefined();
  });

  it('observes the page only while the overlay is visible', () => {
    dispatch({ type: 'OVERLAY_SHOW', payload: { appearance } });

    expect(overlay.show).toHaveBeenCalledWith(appearance, undefined);
    expect(observe).toHaveBeenCalledWith(document.documentElement, {
      childList: true,
      subtree: true,
    });

    dispatch({
      type: 'OVERLAY_APPEARANCE',
      payload: { appearance: { ...appearance, backgroundOpacity: 80 } },
    });
    expect(overlay.setAppearance).toHaveBeenCalledWith({
      ...appearance,
      backgroundOpacity: 80,
    });

    dispatch({ type: 'OVERLAY_HIDE' });
    expect(disconnectObserver).toHaveBeenCalledOnce();
    expect(overlay.hide).toHaveBeenCalledOnce();
  });

  it('rejects messages not sent by a trusted extension context', () => {
    const sendResponse = vi.fn();

    expect(
      listener(
        { type: 'OVERLAY_SHOW', payload: { appearance } },
        { frameId: 0, id: 'test', tab: { id: 42 } as chrome.tabs.Tab },
        sendResponse,
      ),
    ).toBe(false);

    expect(overlay.show).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('logs pointer hit testing and fullscreen failures while captions are visible', () => {
    dispatch({ type: 'OVERLAY_SHOW', payload: { appearance } });

    document.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: 900,
      clientY: 700,
    }));
    document.dispatchEvent(new Event('fullscreenerror'));

    expect(console.info).toHaveBeenCalledWith(
      '[Bilingual Captions][fullscreen-debug]',
      'pointer event',
      expect.objectContaining({
        point: { x: 900, y: 700 },
        type: 'click',
      }),
    );
    expect(console.error).toHaveBeenCalledWith(
      '[Bilingual Captions][fullscreen-debug]',
      'fullscreenerror',
      expect.objectContaining({ type: 'fullscreenerror' }),
    );

    dispatch({ type: 'OVERLAY_HIDE' });
  });

  it('detaches the overlay while YouTube enters fullscreen and restores it afterward', () => {
    vi.useFakeTimers();
    dispatch({ type: 'OVERLAY_SHOW', payload: { appearance } });
    const button = document.createElement('button');
    button.className = 'ytp-fullscreen-button';
    document.body.append(button);

    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(overlay.suspendForFullscreenTransition).toHaveBeenCalledOnce();

    document.dispatchEvent(new Event('fullscreenchange'));
    vi.advanceTimersByTime(350);
    expect(overlay.resumeAfterFullscreenTransition).toHaveBeenCalledOnce();

    dispatch({ type: 'OVERLAY_HIDE' });
  });

  it('requests immersive fullscreen itself instead of letting YouTube use auto navigation UI', async () => {
    dispatch({ type: 'OVERLAY_SHOW', payload: { appearance } });
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    const button = document.createElement('button');
    button.className = 'ytp-fullscreen-button';
    const youtubeClick = vi.fn();
    button.addEventListener('click', youtubeClick);
    document.body.append(button);

    button.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));
    await Promise.resolve();

    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
    expect(youtubeClick).not.toHaveBeenCalled();

    Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
    dispatch({ type: 'OVERLAY_HIDE' });
  });

  it('requests browser fullscreen fallback while the captured tab is fullscreen', async () => {
    vi.useFakeTimers();
    dispatch({ type: 'OVERLAY_SHOW', payload: { appearance } });
    runtimeSendMessage.mockClear();
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.documentElement,
    });

    document.dispatchEvent(new Event('fullscreenchange'));
    await Promise.resolve();
    expect(runtimeSendMessage).toHaveBeenCalledWith({
      target: 'background',
      type: 'BROWSER_FULLSCREEN_FALLBACK',
      payload: { active: true },
    });

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    });
    document.dispatchEvent(new Event('fullscreenchange'));
    await Promise.resolve();
    expect(runtimeSendMessage).toHaveBeenCalledWith({
      target: 'background',
      type: 'BROWSER_FULLSCREEN_FALLBACK',
      payload: { active: false },
    });

    dispatch({ type: 'OVERLAY_HIDE' });
  });
});

function dispatch(message: TabMessage): void {
  listener(message, { id: 'test' }, vi.fn());
}
