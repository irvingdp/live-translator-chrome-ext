import { describe, expect, it, vi } from 'vitest';

import {
  OffscreenCaptureController,
  type AudioPipeline,
  type TranscriptionSession,
} from '../../src/audio/offscreen-capture-controller';
import type { TranscriptEvent } from '../../src/core/transcript-stabilizer';

function createHarness() {
  let samplesListener: ((samples: Float32Array) => void) | undefined;
  let transcriptListener: ((event: TranscriptEvent) => void) | undefined;
  let disconnectListener: (() => void) | undefined;
  let pipelineEndedListener: (() => void) | undefined;
  const pipeline: AudioPipeline = {
    close: vi.fn().mockResolvedValue(undefined),
    onEnded: vi.fn((listener) => {
      pipelineEndedListener = listener;
      return vi.fn();
    }),
    sampleRate: 16_000,
  };
  const session: TranscriptionSession = {
    close: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    onTranscript: vi.fn((listener) => {
      transcriptListener = listener;
      return vi.fn();
    }),
    onDisconnect: vi.fn((listener) => {
      disconnectListener = listener;
      return vi.fn();
    }),
    sendAudio: vi.fn().mockReturnValue(true),
  };
  const createPipeline = vi.fn(async (_streamId, listener) => {
    samplesListener = listener;
    return pipeline;
  });
  const createSession = vi.fn(() => session);
  const emitTranscript = vi.fn();
  const emitDisconnect = vi.fn();
  const controller = new OffscreenCaptureController({
    createPipeline,
    createSession,
    emitDisconnect,
    emitTranscript,
  });
  return {
    controller,
    createPipeline,
    createSession,
    emitTranscript,
    emitDisconnect,
    pipeline,
    samples: (samples: Float32Array) => samplesListener?.(samples),
    session,
    transcript: (event: TranscriptEvent) => transcriptListener?.(event),
    disconnect: () => disconnectListener?.(),
    endPipeline: () => pipelineEndedListener?.(),
  };
}

describe('OffscreenCaptureController', () => {
  it('consumes the expiring tab stream ID before waiting for Deepgram', async () => {
    const harness = createHarness();

    await harness.controller.start({
      apiKey: 'deepgram-key',
      language: 'en-US',
      sessionId: 'session-1',
      streamId: 'tab-stream',
    });

    expect(harness.createSession).toHaveBeenCalledWith({
      apiKey: 'deepgram-key',
      language: 'en-US',
    });
    expect(harness.session.connect).toHaveBeenCalledOnce();
    expect(harness.createPipeline).toHaveBeenCalledWith(
      'tab-stream',
      expect.any(Function),
    );
    expect(harness.createPipeline.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(harness.session.connect).mock.invocationCallOrder[0]!,
    );
  });

  it('chunks pipeline samples and forwards transcripts to the extension', async () => {
    const harness = createHarness();
    await harness.controller.start({
      apiKey: 'deepgram-key',
      language: 'en-US',
      sessionId: 'session-1',
      streamId: 'tab-stream',
    });

    harness.samples(new Float32Array(640).fill(0.5));
    harness.transcript({
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Hello',
    });

    expect(harness.session.sendAudio).toHaveBeenCalledWith(
      expect.objectContaining({ byteLength: 1_280 }),
    );
    expect(harness.emitTranscript).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ text: 'Hello' }),
    );
  });

  it('closes every owned resource when capture stops', async () => {
    const harness = createHarness();
    await harness.controller.start({
      apiKey: 'deepgram-key',
      language: 'en-US',
      sessionId: 'session-1',
      streamId: 'tab-stream',
    });
    harness.samples(new Float32Array(160).fill(0.5));

    await harness.controller.stop('session-1');

    expect(harness.session.sendAudio).toHaveBeenCalledWith(
      expect.objectContaining({ byteLength: 320 }),
    );
    expect(harness.pipeline.close).toHaveBeenCalledOnce();
    expect(harness.session.close).toHaveBeenCalledOnce();
  });

  it('closes the already-consumed tab stream when stopped during Deepgram connect', async () => {
    const harness = createHarness();
    let finishConnect: (() => void) | undefined;
    vi.mocked(harness.session.connect).mockReturnValue(
      new Promise<void>((resolve) => {
        finishConnect = resolve;
      }),
    );

    const starting = harness.controller.start({
      apiKey: 'deepgram-key',
      language: 'en-US',
      sessionId: 'session-1',
      streamId: 'tab-stream',
    });
    await Promise.resolve();
    await harness.controller.stop('session-1');
    finishConnect?.();
    await starting;

    expect(harness.createPipeline).toHaveBeenCalledOnce();
    expect(harness.pipeline.close).toHaveBeenCalledOnce();
    expect(harness.session.close).toHaveBeenCalledOnce();
  });

  it('buffers bounded audio until Deepgram finishes connecting', async () => {
    const harness = createHarness();
    let finishConnect!: () => void;
    vi.mocked(harness.session.connect).mockReturnValue(
      new Promise<void>((resolve) => { finishConnect = resolve; }),
    );
    const starting = harness.controller.start({
      apiKey: 'deepgram-key',
      language: 'en-US',
      sessionId: 'session-1',
      streamId: 'tab-stream',
    });
    await vi.waitFor(() => expect(harness.createPipeline).toHaveBeenCalledOnce());
    harness.samples(new Float32Array(640).fill(0.5));
    expect(harness.session.sendAudio).not.toHaveBeenCalled();

    finishConnect();
    await starting;

    expect(harness.session.sendAudio).toHaveBeenCalledWith(
      expect.objectContaining({ byteLength: 1_280 }),
    );
  });

  it('rolls back the session when Deepgram connection fails', async () => {
    const harness = createHarness();
    vi.mocked(harness.session.connect).mockRejectedValue(
      new Error('connection failed'),
    );

    await expect(
      harness.controller.start({
        apiKey: 'deepgram-key',
        language: 'en-US',
        sessionId: 'session-1',
        streamId: 'tab-stream',
      }),
    ).rejects.toThrow('connection failed');

    expect(harness.session.close).toHaveBeenCalledOnce();
    expect(harness.createPipeline).toHaveBeenCalledOnce();
    expect(harness.pipeline.close).toHaveBeenCalledOnce();
  });

  it('rolls back the session when audio pipeline initialization fails', async () => {
    const harness = createHarness();
    harness.createPipeline.mockRejectedValue(new Error('audio failed'));

    await expect(
      harness.controller.start({
        apiKey: 'deepgram-key',
        language: 'en-US',
        sessionId: 'session-1',
        streamId: 'tab-stream',
      }),
    ).rejects.toThrow('audio failed');

    expect(harness.session.close).toHaveBeenCalledOnce();
  });

  it('closes the Deepgram session even when audio cleanup fails', async () => {
    const harness = createHarness();
    vi.mocked(harness.pipeline.close).mockRejectedValue(
      new Error('close failed'),
    );
    await harness.controller.start({
      apiKey: 'deepgram-key',
      language: 'en-US',
      sessionId: 'session-1',
      streamId: 'tab-stream',
    });

    await expect(harness.controller.stop('session-1')).rejects.toThrow('close failed');

    expect(harness.session.close).toHaveBeenCalledOnce();
  });

  it('tears down audio and reports an unexpected Deepgram disconnect', async () => {
    const harness = createHarness();
    await harness.controller.start({
      apiKey: 'deepgram-key',
      language: 'en-US',
      sessionId: 'session-1',
      streamId: 'tab-stream',
    });

    harness.disconnect();
    await vi.waitFor(() => {
      expect(harness.pipeline.close).toHaveBeenCalledOnce();
      expect(harness.session.close).toHaveBeenCalledOnce();
      expect(harness.emitDisconnect).toHaveBeenCalledWith('session-1');
    });
  });

  it('tears down and reports disconnect when Chrome ends the captured track', async () => {
    const harness = createHarness();
    await harness.controller.start({
      apiKey: 'deepgram-key',
      language: 'en-US',
      sessionId: 'session-1',
      streamId: 'tab-stream',
    });

    harness.endPipeline();

    await vi.waitFor(() => {
      expect(harness.pipeline.close).toHaveBeenCalledOnce();
      expect(harness.session.close).toHaveBeenCalledOnce();
      expect(harness.emitDisconnect).toHaveBeenCalledWith('session-1');
    });
  });

  it('ignores a stop message from an older session', async () => {
    const harness = createHarness();
    await harness.controller.start({
      apiKey: 'deepgram-key',
      language: 'en-US',
      sessionId: 'current-session',
      streamId: 'tab-stream',
    });

    await harness.controller.stop('old-session');

    expect(harness.pipeline.close).not.toHaveBeenCalled();
    expect(harness.session.close).not.toHaveBeenCalled();
  });
});
