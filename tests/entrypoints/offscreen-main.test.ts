import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AudioPipeline, TranscriptionSession } from '../../src/audio/offscreen-capture-controller';
import type { ExtensionMessage } from '../../src/core/messages';

const audio = vi.hoisted(() => ({
  createPipeline: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock('../../src/audio/browser-tab-audio-pipeline', () => ({
  createBrowserTabAudioPipeline: audio.createPipeline,
}));

vi.mock('../../src/audio/offscreen-capture-controller', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/audio/offscreen-capture-controller')
  >('../../src/audio/offscreen-capture-controller');
  return {
    ...actual,
    createDeepgramSession: audio.createSession,
  };
});

type OffscreenListener = (
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

let listener: OffscreenListener;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let pipeline: AudioPipeline;
let runtimeSendMessage: ReturnType<typeof vi.fn>;
let transcriptionSession: TranscriptionSession;
let emitUnexpectedDisconnect: () => void;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  audio.createPipeline.mockReset();
  audio.createSession.mockReset();

  pipeline = {
    close: vi.fn().mockResolvedValue(undefined),
    onEnded: vi.fn(() => vi.fn()),
    sampleRate: 16_000,
  };
  emitUnexpectedDisconnect = () => undefined;
  transcriptionSession = {
    close: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    onDisconnect: vi.fn((registered) => {
      emitUnexpectedDisconnect = registered;
      return vi.fn();
    }),
    onTranscript: vi.fn(() => vi.fn()),
    sendAudio: vi.fn().mockReturnValue(true),
  };
  audio.createPipeline.mockResolvedValue(pipeline);
  audio.createSession.mockReturnValue(transcriptionSession);
  fetcher = vi.fn<typeof fetch>();
  runtimeSendMessage = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: vi.fn((registered: OffscreenListener) => {
          listener = registered;
        }),
      },
      sendMessage: runtimeSendMessage,
    },
  });

  await import('../../entrypoints/offscreen/main');
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('offscreen runtime listener', () => {
  it('keeps the response channel open until translation returns its exact result', async () => {
    await startCapture('session-1');
    const response = new Response(JSON.stringify({
      translations: [{ text: '早安' }],
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
    const gate = Promise.withResolvers<Response>();
    fetcher.mockReturnValueOnce(gate.promise);

    const translation = dispatch({
      target: 'offscreen',
      type: 'TRANSLATE_REQUEST',
      payload: {
        request: {
          apiKey: 'deepl-key:fx',
          sourceLanguage: 'EN',
          targetLanguage: 'ZH-HANT',
          text: 'Good morning',
        },
        requestId: 'request-1',
        sessionId: 'session-1',
      },
    });

    expect(translation.keepOpen).toBe(true);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(translation.sendResponse).not.toHaveBeenCalled();
    gate.resolve(response);
    await vi.waitFor(() => {
      expect(translation.sendResponse).toHaveBeenCalledWith({
        ok: true,
        text: '早安',
      });
    });
  });

  it('cancels translation without stopping the active audio capture', async () => {
    await startCapture('session-1');

    const cancellation = dispatch({
      target: 'offscreen',
      type: 'TRANSLATE_CANCEL',
      payload: { requestId: 'request-1', sessionId: 'session-1' },
    });

    await vi.waitFor(() => {
      expect(cancellation.sendResponse).toHaveBeenCalledWith({
        error: 'cancelled',
        ok: false,
      });
    });
    expect(pipeline.close).not.toHaveBeenCalled();
  });

  it('rejects stale translation after session replacement and stops only the current session', async () => {
    await startCapture('session-1');
    await startCapture('session-2');
    fetcher.mockResolvedValue(new Response(JSON.stringify({
      translations: [{ text: '新工作階段' }],
    }), { status: 200 }));

    const stale = dispatch(translationMessage('session-1', 'request-old'));
    await vi.waitFor(() => {
      expect(stale.sendResponse).toHaveBeenCalledWith({
        error: 'cancelled',
        ok: false,
      });
    });
    expect(fetcher).not.toHaveBeenCalled();

    const current = dispatch(translationMessage('session-2', 'request-new'));
    await vi.waitFor(() => {
      expect(current.sendResponse).toHaveBeenCalledWith({
        ok: true,
        text: '新工作階段',
      });
    });

    const stopped = dispatch({
      target: 'offscreen',
      type: 'CAPTURE_STOP',
      payload: { sessionId: 'session-2' },
    });
    await vi.waitFor(() => expect(stopped.sendResponse).toHaveBeenCalledWith({ ok: true }));

    const afterStop = dispatch(translationMessage('session-2', 'request-after-stop'));
    await vi.waitFor(() => {
      expect(afterStop.sendResponse).toHaveBeenCalledWith({
        error: 'cancelled',
        ok: false,
      });
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rolls back translation state when audio capture start fails', async () => {
    vi.mocked(transcriptionSession.connect).mockRejectedValueOnce(
      new Error('Deepgram start failed'),
    );
    const started = dispatch(captureStartMessage('session-1'));
    await vi.waitFor(() => {
      expect(started.sendResponse).toHaveBeenCalledWith({
        error: 'Deepgram start failed',
        ok: false,
      });
    });
    fetcher.mockResolvedValue(new Response(JSON.stringify({
      translations: [{ text: '不應翻譯' }],
    }), { status: 200 }));

    const translation = dispatch(translationMessage('session-1', 'request-1'));
    await vi.waitFor(() => {
      expect(translation.sendResponse).toHaveBeenCalledWith({
        error: 'cancelled',
        ok: false,
      });
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('cancels a pending translation after an unexpected disconnect', async () => {
    await startCapture('session-1');
    const pendingFetch = createPendingFetch();
    const translation = dispatch(translationMessage('session-1', 'request-1'));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

    emitUnexpectedDisconnect();
    await vi.waitFor(() => {
      expect(runtimeSendMessage).toHaveBeenCalledWith({
        target: 'background',
        type: 'CAPTURE_DISCONNECTED',
        payload: { sessionId: 'session-1' },
      });
    });
    const wasAborted = pendingFetch.signal?.aborted ?? false;
    if (!wasAborted) pendingFetch.resolve(successfulTranslationResponse());
    await vi.waitFor(() => expect(translation.sendResponse).toHaveBeenCalled());

    expect(wasAborted).toBe(true);
    expect(translation.sendResponse).toHaveBeenCalledWith({
      error: 'cancelled',
      ok: false,
    });
  });

  it('cancels a pending translation when keepalive finds an orphaned session', async () => {
    runtimeSendMessage.mockImplementation((message: ExtensionMessage) =>
      Promise.resolve(
        message.type === 'CAPTURE_KEEPALIVE'
          ? { status: { state: 'idle' } }
          : undefined,
      ),
    );
    await startCapture('session-1');
    const pendingFetch = createPendingFetch();
    const translation = dispatch(translationMessage('session-1', 'request-1'));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(20_000);
    await vi.waitFor(() => expect(pipeline.close).toHaveBeenCalledOnce());
    const wasAborted = pendingFetch.signal?.aborted ?? false;
    if (!wasAborted) pendingFetch.resolve(successfulTranslationResponse());
    await vi.waitFor(() => expect(translation.sendResponse).toHaveBeenCalled());

    expect(wasAborted).toBe(true);
    expect(translation.sendResponse).toHaveBeenCalledWith({
      error: 'cancelled',
      ok: false,
    });
  });
});

function dispatch(message: ExtensionMessage) {
  const sendResponse = vi.fn();
  const keepOpen = listener(message, {} as chrome.runtime.MessageSender, sendResponse);
  return { keepOpen, sendResponse };
}

async function startCapture(sessionId: string): Promise<void> {
  const started = dispatch(captureStartMessage(sessionId));
  expect(started.keepOpen).toBe(true);
  await vi.waitFor(() => expect(started.sendResponse).toHaveBeenCalledWith({ ok: true }));
}

function captureStartMessage(
  sessionId: string,
): Extract<ExtensionMessage, { type: 'CAPTURE_START' }> {
  return {
    target: 'offscreen',
    type: 'CAPTURE_START',
    payload: {
      apiKey: 'deepgram-key',
      language: 'en-US',
      sessionId,
      streamId: `stream-${sessionId}`,
    },
  };
}

function translationMessage(
  sessionId: string,
  requestId: string,
): Extract<ExtensionMessage, { type: 'TRANSLATE_REQUEST' }> {
  return {
    target: 'offscreen',
    type: 'TRANSLATE_REQUEST',
    payload: {
      request: {
        apiKey: 'deepl-key:fx',
        sourceLanguage: 'EN',
        targetLanguage: 'ZH-HANT',
        text: 'New session',
      },
      requestId,
      sessionId,
    },
  };
}

function createPendingFetch() {
  const gate = Promise.withResolvers<Response>();
  let signal: AbortSignal | undefined;
  fetcher.mockImplementationOnce((_input, init) => {
    signal = init?.signal ?? undefined;
    signal?.addEventListener('abort', () => {
      gate.reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
    return gate.promise;
  });
  return {
    resolve: gate.resolve,
    get signal() {
      return signal;
    },
  };
}

function successfulTranslationResponse(): Response {
  return new Response(JSON.stringify({
    translations: [{ text: '完成' }],
  }), { status: 200 });
}
