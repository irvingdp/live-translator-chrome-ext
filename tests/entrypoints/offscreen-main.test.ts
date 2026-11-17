import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AudioPipeline,
  CaptureEvent,
  CaptureSession,
} from '../../src/audio/offscreen-capture-controller';
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
    createCaptureSession: audio.createSession,
  };
});

type OffscreenListener = (
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

let listener: OffscreenListener;
let pipeline: AudioPipeline;
let runtimeSendMessage: ReturnType<typeof vi.fn>;
let transcriptionSession: CaptureSession;
let emitUnexpectedDisconnect: () => void;
let emitCaptureEvent: (event: CaptureEvent) => void;

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
  emitCaptureEvent = () => undefined;
  transcriptionSession = {
    audioChunkMs: 40,
    close: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    onDisconnect: vi.fn((registered) => {
      emitUnexpectedDisconnect = registered;
      return vi.fn();
    }),
    onEvent: vi.fn((registered) => {
      emitCaptureEvent = registered;
      return vi.fn();
    }),
    sendAudio: vi.fn().mockReturnValue(true),
    updateMaxLineWidth: vi.fn(),
  };
  audio.createPipeline.mockResolvedValue(pipeline);
  audio.createSession.mockReturnValue(transcriptionSession);
  runtimeSendMessage = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test',
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
  it('rejects capture commands sent from a content script', () => {
    const sendResponse = vi.fn();

    const keepOpen = listener(
      captureStartMessage('session-1'),
      {
        frameId: 0,
        id: 'test',
        tab: { id: 42 } as chrome.tabs.Tab,
      },
      sendResponse,
    );

    expect(keepOpen).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
    expect(audio.createPipeline).not.toHaveBeenCalled();
  });

  it('updates sentence width on the active capture session', async () => {
    await startCapture('session-1');

    const update = dispatch({
      target: 'offscreen',
      type: 'CAPTURE_CONFIG_UPDATE',
      payload: { maxLineWidth: 60, sessionId: 'session-1' },
    });

    await vi.waitFor(() => {
      expect(update.sendResponse).toHaveBeenCalledWith({ ok: true });
    });
    expect(transcriptionSession.updateMaxLineWidth).toHaveBeenCalledWith(60);
  });

  it('forwards a Gemini sentence batch in one runtime message', async () => {
    await startCapture('session-1');
    runtimeSendMessage.mockClear();

    emitCaptureEvent({
      kind: 'pairs',
      updates: [
        { id: 'turn-0#0', original: 'One.' },
        { id: 'turn-0#1', original: 'Two.' },
      ],
    });

    expect(runtimeSendMessage).toHaveBeenCalledOnce();
    expect(runtimeSendMessage).toHaveBeenCalledWith({
      target: 'background',
      type: 'CAPTION_PAIR_UPDATES',
      payload: {
        sessionId: 'session-1',
        updates: [
          { id: 'turn-0#0', original: 'One.' },
          { id: 'turn-0#1', original: 'Two.' },
        ],
      },
    });
  });

  it('reports a failed capture start and tears the session down', async () => {
    vi.mocked(transcriptionSession.connect).mockRejectedValueOnce(
      new Error('Gemini start failed'),
    );
    const started = dispatch(captureStartMessage('session-1'));
    await vi.waitFor(() => {
      expect(started.sendResponse).toHaveBeenCalledWith({
        error: 'Gemini start failed',
        ok: false,
      });
    });
    expect(pipeline.close).toHaveBeenCalled();
  });

  it('tears down audio and tells the background after an unexpected disconnect', async () => {
    await startCapture('session-1');

    emitUnexpectedDisconnect();

    await vi.waitFor(() => {
      expect(runtimeSendMessage).toHaveBeenCalledWith({
        target: 'background',
        type: 'CAPTURE_DISCONNECTED',
        payload: { sessionId: 'session-1' },
      });
    });
    expect(pipeline.close).toHaveBeenCalledOnce();
  });

  it('tears down a session the keepalive finds orphaned', async () => {
    runtimeSendMessage.mockImplementation((message: ExtensionMessage) =>
      Promise.resolve(
        message.type === 'CAPTURE_KEEPALIVE'
          ? { status: { state: 'idle' } }
          : undefined,
      ),
    );
    await startCapture('session-1');

    await vi.advanceTimersByTimeAsync(20_000);

    await vi.waitFor(() => expect(pipeline.close).toHaveBeenCalledOnce());
  });
});

function dispatch(message: ExtensionMessage) {
  const sendResponse = vi.fn();
  const keepOpen = listener(
    message,
    { id: 'test' } as chrome.runtime.MessageSender,
    sendResponse,
  );
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
      apiKey: 'gemini-key',
      maxLineWidth: 90,
      sessionId,
      streamId: `stream-${sessionId}`,
      targetLanguage: 'zh-Hant',
    },
  };
}
