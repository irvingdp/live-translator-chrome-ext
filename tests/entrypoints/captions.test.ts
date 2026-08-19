import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TabMessage } from '../../src/core/capture-session-controller';
import type { CaptionAppearance } from '../../src/core/settings';

const overlay = vi.hoisted(() => ({
  clearSessionError: vi.fn(),
  hide: vi.fn(),
  position: vi.fn(),
  setAppearance: vi.fn(),
  setSessionError: vi.fn(),
  setWindow: vi.fn(),
  show: vi.fn(),
}));

vi.mock('../../src/content/caption-overlay', () => ({
  CaptionOverlay: class {
    clearSessionError = overlay.clearSessionError;
    hide = overlay.hide;
    position = overlay.position;
    setAppearance = overlay.setAppearance;
    setSessionError = overlay.setSessionError;
    setWindow = overlay.setWindow;
    show = overlay.show;
  },
}));

const appearance: CaptionAppearance = {
  backgroundOpacity: 50,
  bottomOffset: 1,
  captionWidth: 70,
  maxVisibleRows: 2,
  originalFontSize: 24,
  translationFontSize: 22,
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

afterEach(() => vi.restoreAllMocks());

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

    expect(overlay.show).toHaveBeenCalledWith(appearance);
    expect(observe).toHaveBeenCalledWith(document.documentElement, {
      childList: true,
      subtree: true,
    });

    dispatch({
      type: 'OVERLAY_APPEARANCE',
      payload: { appearance: { ...appearance, captionWidth: 80 } },
    });
    expect(overlay.setAppearance).toHaveBeenCalledWith({
      ...appearance,
      captionWidth: 80,
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
});

function dispatch(message: TabMessage): void {
  listener(message, { id: 'test' }, vi.fn());
}
