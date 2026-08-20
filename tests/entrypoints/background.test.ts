import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExtensionMessage } from '../../src/core/messages';
import type { AppSettings } from '../../src/core/settings';

type BackgroundListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

const settings: AppSettings = {
  backgroundOpacity: 78,
  deepgramApiKey: 'deepgram-key',
  deeplApiKey: 'deepl-key:fx',
  geminiApiKey: 'gemini-key',
  geminiTargetLanguage: 'zh-Hant',
  maxLineWidth: 90,
  minLineWidth: 40,
  originalFontSize: 24,
  sourceLanguage: 'EN',
  sourceLocale: 'en-US',
  targetLanguage: 'ZH-HANT',
  transcriber: 'deepgram',
  translationFontSize: 22,
};

let listener: BackgroundListener;
let onSettingsChanged: (
  changes: Record<string, { newValue?: unknown }>,
  area: string,
) => void;
let onRuntimeConnect: (port: chrome.runtime.Port) => void;
let onTabRemoved: (tabId: number) => void;
let onTabUpdated: (
  tabId: number,
  changeInfo: { status?: string },
) => void;
let offscreenExists: boolean;
let closeDocument: ReturnType<typeof vi.fn>;
let createDocument: ReturnType<typeof vi.fn>;
let executeScript: ReturnType<typeof vi.fn>;
let getStreamId: ReturnType<typeof vi.fn>;
let localStorageData: Record<string, unknown>;
let removeSessionStorage: ReturnType<typeof vi.fn>;
let runtimeSendMessage: ReturnType<typeof vi.fn>;
let setLocalAccessLevel: ReturnType<typeof vi.fn>;
let sidePanelOpen: ReturnType<typeof vi.fn>;
let sidePanelSetOptions: ReturnType<typeof vi.fn>;
let tabsSendMessage: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  offscreenExists = false;
  closeDocument = vi.fn(async () => {
    offscreenExists = false;
  });
  createDocument = vi.fn(async () => {
    offscreenExists = true;
  });
  executeScript = vi.fn().mockResolvedValue(undefined);
  getStreamId = vi.fn().mockResolvedValue('stream-id');
  localStorageData = {};
  removeSessionStorage = vi.fn().mockResolvedValue(undefined);
  setLocalAccessLevel = vi.fn().mockResolvedValue(undefined);
  sidePanelOpen = vi.fn().mockResolvedValue(undefined);
  sidePanelSetOptions = vi.fn().mockResolvedValue(undefined);
  runtimeSendMessage = vi.fn(async (message: ExtensionMessage) => {
    if (message.target === 'offscreen') return { ok: true };
    return undefined;
  });
  tabsSendMessage = vi.fn(
    async (_tabId: number, message: { type: string }) =>
      message.type === 'CONTENT_PING' ? { ok: true } : undefined,
  );
  vi.stubGlobal('defineBackground', (register: () => void) => register());
  vi.stubGlobal('chrome', {
    offscreen: {
      Reason: { USER_MEDIA: 'USER_MEDIA' },
      closeDocument,
      createDocument,
    },
    runtime: {
      id: 'test',
      getContexts: vi.fn(async () => offscreenExists ? [{}] : []),
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      onMessage: {
        addListener: vi.fn((registered: BackgroundListener) => {
          listener = registered;
        }),
      },
      onConnect: {
        addListener: vi.fn((registered: (port: chrome.runtime.Port) => void) => {
          onRuntimeConnect = registered;
        }),
      },
      sendMessage: runtimeSendMessage,
    },
    scripting: {
      executeScript,
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: localStorageData[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(localStorageData, values);
        }),
        setAccessLevel: setLocalAccessLevel,
      },
      onChanged: {
        addListener: vi.fn(
          (
            callback: (
              changes: Record<string, { newValue?: unknown }>,
              area: string,
            ) => void,
          ) => {
            onSettingsChanged = callback;
          },
        ),
      },
      session: {
        get: vi.fn().mockResolvedValue({}),
        remove: removeSessionStorage,
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
    tabCapture: { getMediaStreamId: getStreamId },
    sidePanel: {
      open: sidePanelOpen,
      setOptions: sidePanelSetOptions,
    },
    tabs: {
      get: vi.fn(async (tabId: number) => ({
        id: tabId,
        url: 'https://example.com/watch',
      })),
      onUpdated: {
        addListener: vi.fn(
          (
            registered: (
              tabId: number,
              changeInfo: { status?: string },
            ) => void,
          ) => {
            onTabUpdated = registered;
          },
        ),
      },
      onRemoved: {
        addListener: vi.fn((registered: (tabId: number) => void) => {
          onTabRemoved = registered;
        }),
      },
      sendMessage: tabsSendMessage,
    },
  });

  await import('../../entrypoints/background');
});

afterEach(() => vi.unstubAllGlobals());

describe('background offscreen document lifecycle', () => {
  it('restricts local storage before accepting session control', async () => {
    await dispatch({ target: 'background', type: 'SESSION_STATUS' });

    expect(setLocalAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
    expect(setLocalAccessLevel.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(chrome.storage.session.get).mock.invocationCallOrder[0]!,
    );
  });

  it('injects the unlisted caption bundle only when the active receiver is absent', async () => {
    tabsSendMessage.mockRejectedValueOnce(new Error('receiver missing'));

    await startSession();

    expect(executeScript).toHaveBeenCalledWith({
      files: ['captions.js'],
      target: { tabId: 42 },
    });
  });

  it('awaits CAPTURE_STOP before closing the document on normal stop', async () => {
    await startSession();

    const response = await dispatch({
      target: 'background',
      type: 'SESSION_STOP',
    });

    expect(response).toMatchObject({ ok: true, status: { state: 'idle' } });
    const stopCall = runtimeSendMessage.mock.calls.find(
      ([message]) => message.type === 'CAPTURE_STOP',
    );
    expect(stopCall).toBeDefined();
    expect(closeDocument).toHaveBeenCalledOnce();
    expect(runtimeSendMessage.mock.invocationCallOrder.at(-1)).toBeLessThan(
      closeDocument.mock.invocationCallOrder[0]!,
    );
    expect(offscreenExists).toBe(false);
  });

  it('closes a document created before capture startup fails', async () => {
    getStreamId.mockRejectedValueOnce(new Error('stream denied'));

    const response = await dispatch(sessionStartMessage());

    expect(response).toMatchObject({ error: 'stream denied', ok: false });
    expect(createDocument).toHaveBeenCalledOnce();
    expect(closeDocument).toHaveBeenCalledOnce();
    expect(offscreenExists).toBe(false);
  });

  it('stops capture and closes the document when the captured tab is removed', async () => {
    await startSession();

    onTabRemoved(42);
    await vi.waitFor(() => expect(closeDocument).toHaveBeenCalledOnce());

    expect(runtimeSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CAPTURE_STOP' }),
    );
    expect(removeSessionStorage).toHaveBeenCalledWith('activeSession');
    expect(offscreenExists).toBe(false);
  });

  it('closes the document after the current offscreen session disconnects', async () => {
    await startSession();
    const sessionId = activeSessionId();

    const response = await dispatch({
      target: 'background',
      type: 'CAPTURE_DISCONNECTED',
      payload: { sessionId },
    });

    expect(response).toEqual({ ok: true });
    expect(closeDocument).toHaveBeenCalledOnce();
    expect(removeSessionStorage).toHaveBeenCalledWith('activeSession');
    expect(offscreenExists).toBe(false);
  });

  it('stops an orphan reported by keepalive before closing its document', async () => {
    offscreenExists = true;

    const response = await dispatch({
      target: 'background',
      type: 'CAPTURE_KEEPALIVE',
      payload: { sessionId: 'orphan-session' },
    });

    expect(response).toEqual({ ok: true, status: { state: 'idle' } });
    expect(runtimeSendMessage).toHaveBeenCalledWith({
      target: 'offscreen',
      type: 'CAPTURE_STOP',
      payload: { sessionId: 'orphan-session' },
    });
    expect(closeDocument).toHaveBeenCalledOnce();
    expect(runtimeSendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      closeDocument.mock.invocationCallOrder[0]!,
    );
  });

  it('serializes stop and restart so closure cannot tear down the new session', async () => {
    await startSession();
    const stopGate = Promise.withResolvers<{ ok: true }>();
    runtimeSendMessage.mockImplementation((message: ExtensionMessage) =>
      message.type === 'CAPTURE_STOP'
        ? stopGate.promise
        : Promise.resolve({ ok: true }),
    );

    const stopping = dispatch({ target: 'background', type: 'SESSION_STOP' });
    await vi.waitFor(() => {
      expect(runtimeSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'CAPTURE_STOP' }),
      );
    });
    const restarting = dispatch(sessionStartMessage());
    await Promise.resolve();
    expect(createDocument).toHaveBeenCalledOnce();

    stopGate.resolve({ ok: true });
    await Promise.all([stopping, restarting]);

    expect(closeDocument).toHaveBeenCalledOnce();
    expect(createDocument).toHaveBeenCalledTimes(2);
    expect(closeDocument.mock.invocationCallOrder[0]).toBeLessThan(
      createDocument.mock.invocationCallOrder[1]!,
    );
    expect(offscreenExists).toBe(true);
  });

  it('tolerates a document that closes before closeDocument runs', async () => {
    await startSession();
    closeDocument.mockRejectedValueOnce(new Error('No current offscreen document'));

    const response = await dispatch({
      target: 'background',
      type: 'SESSION_STOP',
    });

    expect(response).toMatchObject({ ok: true, status: { state: 'idle' } });
    expect(closeDocument).toHaveBeenCalledOnce();
  });

  it('registers a settings listener that survives an unrelated storage change', () => {
    expect(onSettingsChanged).toBeTypeOf('function');

    expect(() => {
      onSettingsChanged({ other: { newValue: 1 } }, 'local');
      onSettingsChanged({ settings: { newValue: { maxLineWidth: 55 } } }, 'sync');
      onSettingsChanged({ settings: { newValue: { maxLineWidth: 55 } } }, 'local');
      onSettingsChanged({ settings: {} }, 'local');
    }).not.toThrow();
  });

  it('routes one Gemini sentence batch to one caption-window render', async () => {
    await startSession();
    tabsSendMessage.mockClear();

    const response = await dispatch({
      target: 'background',
      type: 'CAPTION_PAIR_UPDATES',
      payload: {
        sessionId: activeSessionId(),
        updates: [
          { id: 'turn-0#0', original: 'One.', translation: '一。' },
          { id: 'turn-0#1', original: 'Two.', translation: '二。' },
        ],
      },
    });

    expect(response).toEqual({ ok: true });
    expect(tabsSendMessage).toHaveBeenCalledOnce();
    expect(tabsSendMessage).toHaveBeenCalledWith(42, {
      type: 'CAPTION_WINDOW',
      payload: {
        pairs: [
          { id: 'turn-0#0', original: 'One.', translation: '一。' },
          { id: 'turn-0#1', original: 'Two.', translation: '二。' },
        ],
      },
    });
  });

  it('sends only projected appearance data after a live settings change', async () => {
    await startSession();
    tabsSendMessage.mockClear();

    onSettingsChanged(
      {
        settings: {
          newValue: {
            ...settings,
            backgroundOpacity: 88,
            geminiApiKey: 'must-not-leak',
          },
        },
      },
      'local',
    );

    await vi.waitFor(() => {
      expect(tabsSendMessage).toHaveBeenCalledWith(42, {
        type: 'OVERLAY_APPEARANCE',
        payload: {
          appearance: expect.objectContaining({ backgroundOpacity: 88 }),
        },
      });
    });
    const appearanceMessage = tabsSendMessage.mock.calls
      .map(([, message]) => message)
      .find((message) => message.type === 'OVERLAY_APPEARANCE');
    expect(appearanceMessage).not.toHaveProperty(
      'payload.appearance.geminiApiKey',
    );
  });

  it('restores the overlay after a same-origin tab reload', async () => {
    await startSession();
    tabsSendMessage.mockClear();

    onTabUpdated(42, { status: 'complete' });

    await vi.waitFor(() => {
      expect(tabsSendMessage).toHaveBeenCalledWith(42, {
        type: 'OVERLAY_SHOW',
        payload: {
          appearance: expect.any(Object),
          layout: undefined,
        },
      });
      expect(tabsSendMessage).toHaveBeenCalledWith(42, {
        type: 'CAPTION_WINDOW',
        payload: { pairs: [] },
      });
    });
  });

  it('opens Chrome Side Panel and fully switches the webpage overlay to native mode', async () => {
    await startSession();
    tabsSendMessage.mockClear();
    vi.mocked(chrome.tabs.get).mockClear();
    const layout = {
      floatingRect: {
        heightRatio: 0.25,
        widthRatio: 0.6,
        xRatio: 0.2,
        yRatio: 0.6,
      },
      mode: 'floating' as const,
      version: 1 as const,
    };

    const response = await dispatchFrom(
      { target: 'background', type: 'OPEN_SIDE_PANEL', payload: { layout } },
      {
        frameId: 0,
        id: 'test',
        tab: { id: 42 } as chrome.tabs.Tab,
      },
    );

    expect(response).toMatchObject({ ok: true, layout: { mode: 'native' } });
    expect(sidePanelOpen).toHaveBeenCalledWith({ tabId: 42 });
    expect(sidePanelOpen.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(chrome.tabs.get).mock.invocationCallOrder[0]!,
    );
    expect(tabsSendMessage).toHaveBeenCalledWith(42, {
      type: 'OVERLAY_LAYOUT',
      payload: { layout: expect.objectContaining({ mode: 'native' }) },
    });
  });

  it('restores the floating caption surface when the Side Panel closes', async () => {
    await startSession();
    await dispatchFrom(
      {
        target: 'background',
        type: 'OPEN_SIDE_PANEL',
        payload: {
          layout: {
            floatingRect: {
              heightRatio: 0.25,
              widthRatio: 0.6,
              xRatio: 0.2,
              yRatio: 0.6,
            },
            mode: 'floating',
            version: 1,
          },
        },
      },
      { frameId: 0, id: 'test', tab: { id: 42 } as chrome.tabs.Tab },
    );
    tabsSendMessage.mockClear();
    let disconnect: (() => void) | undefined;
    onRuntimeConnect({
      name: 'caption-side-panel',
      onDisconnect: {
        addListener: vi.fn((listener: () => void) => { disconnect = listener; }),
      },
      postMessage: vi.fn(),
      sender: { id: 'test', url: 'chrome-extension://test/sidepanel.html' },
    } as unknown as chrome.runtime.Port);

    disconnect?.();

    await vi.waitFor(() => expect(tabsSendMessage).toHaveBeenCalledWith(42, {
      type: 'OVERLAY_LAYOUT',
      payload: { layout: expect.objectContaining({ mode: 'floating' }) },
    }));
  });

  it('shares caption state only with the trusted Side Panel port', async () => {
    const untrustedPost = vi.fn();
    onRuntimeConnect({
      name: 'caption-side-panel',
      onDisconnect: { addListener: vi.fn() },
      postMessage: untrustedPost,
      sender: {
        frameId: 0,
        id: 'test',
        tab: { id: 42 } as chrome.tabs.Tab,
      },
    } as unknown as chrome.runtime.Port);
    await Promise.resolve();
    expect(untrustedPost).not.toHaveBeenCalled();

    const trustedPost = vi.fn();
    onRuntimeConnect({
      name: 'caption-side-panel',
      onDisconnect: { addListener: vi.fn() },
      postMessage: trustedPost,
      sender: { id: 'test', url: 'chrome-extension://test/sidepanel.html' },
    } as unknown as chrome.runtime.Port);

    await vi.waitFor(() => expect(trustedPost).toHaveBeenCalledWith({
      type: 'SIDE_PANEL_STATE',
      payload: { active: false, pairs: [], status: { state: 'idle' } },
    }));
  });

  it('starts a fresh session in floating mode while preserving its saved rectangle', async () => {
    const nativeLayout = {
      floatingRect: {
        heightRatio: 0.35,
        widthRatio: 0.55,
        xRatio: 0.12,
        yRatio: 0.42,
      },
      mode: 'native',
      version: 1,
    };
    localStorageData.overlayLayoutsByOrigin = {
      layouts: { 'https://example.com': nativeLayout },
      order: ['https://example.com'],
      version: 1,
    };

    await startSession();

    expect(tabsSendMessage).toHaveBeenCalledWith(42, {
      type: 'OVERLAY_SHOW',
      payload: {
        appearance: expect.any(Object),
        layout: expect.objectContaining({
          floatingRect: nativeLayout.floatingRect,
          mode: 'floating',
        }),
      },
    });
  });

  it('stops capture when navigation revokes script injection access', async () => {
    await startSession();
    tabsSendMessage.mockRejectedValue(new Error('receiver missing'));
    executeScript.mockRejectedValue(new Error('Cannot access page'));

    onTabUpdated(42, { status: 'complete' });

    await vi.waitFor(() => {
      expect(closeDocument).toHaveBeenCalledOnce();
      expect(removeSessionStorage).toHaveBeenCalledWith('activeSession');
    });
    expect(runtimeSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CAPTURE_STOP' }),
    );
  });

  it('rejects privileged messages sent from a content script', () => {
    const sendResponse = vi.fn();

    const keepOpen = listener(
      sessionStartMessage(),
      {
        frameId: 0,
        id: 'test',
        tab: { id: 42 } as chrome.tabs.Tab,
      },
      sendResponse,
    );

    expect(keepOpen).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('ignores malformed runtime messages without throwing', () => {
    const sendResponse = vi.fn();

    expect(
      listener(
        null,
        { id: 'test', url: 'chrome-extension://test/popup.html' },
        sendResponse,
      ),
    ).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});

function dispatch(message: ExtensionMessage): Promise<unknown> {
  const sender: chrome.runtime.MessageSender = message.type.startsWith('SESSION_')
    ? {
        id: 'test',
        url: 'chrome-extension://test/popup.html',
      }
    : {
        id: 'test',
        url: 'chrome-extension://test/offscreen.html',
      };
  return dispatchFrom(message, sender);
}

function dispatchFrom(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const response = Promise.withResolvers<unknown>();
  expect(listener(message, sender, response.resolve)).toBe(true);
  return response.promise;
}

async function startSession(): Promise<void> {
  const response = await dispatch(sessionStartMessage());
  expect(response).toMatchObject({ ok: true, status: { state: 'running' } });
}

function sessionStartMessage(): Extract<ExtensionMessage, { type: 'SESSION_START' }> {
  return {
    target: 'background',
    type: 'SESSION_START',
    payload: { settings, tabId: 42 },
  };
}

function activeSessionId(): string {
  const message = runtimeSendMessage.mock.calls
    .map(([candidate]) => candidate as ExtensionMessage)
    .find((candidate) => candidate.type === 'CAPTURE_START');
  if (!message || message.type !== 'CAPTURE_START') {
    throw new Error('missing CAPTURE_START');
  }
  return message.payload.sessionId;
}
