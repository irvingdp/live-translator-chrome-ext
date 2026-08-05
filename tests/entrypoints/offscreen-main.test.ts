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
  const transcriptionSession: TranscriptionSession = {
    close: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    onDisconnect: vi.fn(() => vi.fn()),
    onTranscript: vi.fn(() => vi.fn()),
    sendAudio: vi.fn().mockReturnValue(true),
  };
  audio.createPipeline.mockResolvedValue(pipeline);
  audio.createSession.mockReturnValue(transcriptionSession);
  fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: vi.fn((registered: OffscreenListener) => {
          listener = registered;
        }),
      },
      sendMessage: vi.fn().mockResolvedValue(undefined),
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
});

function dispatch(message: ExtensionMessage) {
  const sendResponse = vi.fn();
  const keepOpen = listener(message, {} as chrome.runtime.MessageSender, sendResponse);
  return { keepOpen, sendResponse };
}

async function startCapture(sessionId: string): Promise<void> {
  const started = dispatch({
    target: 'offscreen',
    type: 'CAPTURE_START',
    payload: {
      apiKey: 'deepgram-key',
      language: 'en-US',
      sessionId,
      streamId: `stream-${sessionId}`,
    },
  });
  expect(started.keepOpen).toBe(true);
  await vi.waitFor(() => expect(started.sendResponse).toHaveBeenCalledWith({ ok: true }));
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
