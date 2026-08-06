import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExtensionMessage } from '../../src/core/messages';
import type { AppSettings } from '../../src/core/settings';

type BackgroundListener = (
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

const settings: AppSettings = {
  backgroundOpacity: 78,
  bottomOffset: 8,
  deepgramApiKey: 'deepgram-key',
  deeplApiKey: 'deepl-key:fx',
  maxLineWidth: 90,
  originalFontSize: 24,
  sourceLanguage: 'EN',
  sourceLocale: 'en-US',
  targetLanguage: 'ZH-HANT',
  translationFontSize: 22,
};

let listener: BackgroundListener;
let onTabRemoved: (tabId: number) => void;
let offscreenExists: boolean;
let closeDocument: ReturnType<typeof vi.fn>;
let createDocument: ReturnType<typeof vi.fn>;
let getStreamId: ReturnType<typeof vi.fn>;
let removeSessionStorage: ReturnType<typeof vi.fn>;
let runtimeSendMessage: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  offscreenExists = false;
  closeDocument = vi.fn(async () => {
    offscreenExists = false;
  });
  createDocument = vi.fn(async () => {
    offscreenExists = true;
  });
  getStreamId = vi.fn().mockResolvedValue('stream-id');
  removeSessionStorage = vi.fn().mockResolvedValue(undefined);
  runtimeSendMessage = vi.fn(async (message: ExtensionMessage) => {
    if (message.target === 'offscreen') return { ok: true };
    return undefined;
  });
  vi.stubGlobal('defineBackground', (register: () => void) => register());
  vi.stubGlobal('chrome', {
    offscreen: {
      Reason: { USER_MEDIA: 'USER_MEDIA' },
      closeDocument,
      createDocument,
    },
    runtime: {
      getContexts: vi.fn(async () => offscreenExists ? [{}] : []),
      getURL: vi.fn(() => 'chrome-extension://test/offscreen.html'),
      onMessage: {
        addListener: vi.fn((registered: BackgroundListener) => {
          listener = registered;
        }),
      },
      sendMessage: runtimeSendMessage,
    },
    scripting: {
      executeScript: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      local: { get: vi.fn().mockResolvedValue({}) },
      session: {
        get: vi.fn().mockResolvedValue({}),
        remove: removeSessionStorage,
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
    tabCapture: { getMediaStreamId: getStreamId },
    tabs: {
      onRemoved: {
        addListener: vi.fn((registered: (tabId: number) => void) => {
          onTabRemoved = registered;
        }),
      },
      sendMessage: vi.fn(async (_tabId: number, message: { type: string }) =>
        message.type === 'CONTENT_PING' ? { ok: true } : undefined,
      ),
    },
  });

  await import('../../entrypoints/background');
});

afterEach(() => vi.unstubAllGlobals());

describe('background offscreen document lifecycle', () => {
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
});

function dispatch(message: ExtensionMessage): Promise<unknown> {
  const response = Promise.withResolvers<unknown>();
  expect(listener(message, {} as chrome.runtime.MessageSender, response.resolve))
    .toBe(true);
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
