import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createBrowserTabAudioPipeline,
  TRANSCRIPTION_SAMPLE_RATE,
} from '../../src/audio/browser-tab-audio-pipeline';

interface FakeNode {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  gain: { value: number };
  port: { onmessage: ((event: MessageEvent<unknown>) => void) | null };
}

function fakeNode(): FakeNode {
  return {
    connect: vi.fn((destination: FakeNode) => destination),
    disconnect: vi.fn(),
    gain: { value: 1 },
    port: { onmessage: null },
  };
}

function createHarness({
  processingSampleRate = TRANSCRIPTION_SAMPLE_RATE,
  rejectSilentSink = false,
  rejectWorklet = false,
}: {
  processingSampleRate?: number;
  rejectSilentSink?: boolean;
  rejectWorklet?: boolean;
} = {}) {
  let ended: (() => void) | undefined;
  const track = {
    addEventListener: vi.fn((_type: string, listener: () => void) => {
      ended = listener;
    }),
    removeEventListener: vi.fn(),
    stop: vi.fn(),
  };
  const contexts: Array<{
    audioWorklet: { addModule: ReturnType<typeof vi.fn> };
    close: ReturnType<typeof vi.fn>;
    createGain: ReturnType<typeof vi.fn>;
    destination: FakeNode;
    options: AudioContextOptions;
    sampleRate: number;
    setSinkId: ReturnType<typeof vi.fn>;
    source: FakeNode;
  }> = [];
  const workletNodes: FakeNode[] = [];
  const workletConstructions: unknown[][] = [];

  class WorkingAudioContext {
    readonly audioWorklet = {
      addModule: vi.fn(() =>
        rejectWorklet && contexts.length === 2
          ? Promise.reject(new Error('worklet failed'))
          : Promise.resolve(),
      ),
    };
    readonly close = vi.fn().mockResolvedValue(undefined);
    readonly destination = fakeNode();
    readonly source = fakeNode();
    readonly createGain = vi.fn(() => fakeNode());
    readonly createMediaStreamSource = vi.fn(() => this.source);
    readonly options: AudioContextOptions;
    readonly sampleRate: number;
    readonly setSinkId = vi.fn(() =>
      rejectSilentSink
        ? Promise.reject(new Error('sink unavailable'))
        : Promise.resolve(),
    );

    constructor(options: AudioContextOptions = {}) {
      this.options = options;
      this.sampleRate =
        options.sampleRate === undefined ? 48_000 : processingSampleRate;
      contexts.push(this);
    }
  }

  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }),
    },
  });
  vi.stubGlobal('AudioContext', WorkingAudioContext);
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      constructor(...args: unknown[]) {
        const node = fakeNode();
        workletNodes.push(node);
        workletConstructions.push(args);
        return node;
      }
    },
  );
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `chrome-extension://id/${path}` },
  });

  return {
    contexts,
    endTrack: () => ended?.(),
    track,
    workletConstructions,
    workletNodes,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('createBrowserTabAudioPipeline', () => {
  it('preserves native-rate playback while processing silent 16 kHz audio', async () => {
    const harness = createHarness();
    const onSamples = vi.fn();

    const pipeline = await createBrowserTabAudioPipeline('stream-id', onSamples);

    expect(pipeline.sampleRate).toBe(TRANSCRIPTION_SAMPLE_RATE);
    expect(harness.contexts).toHaveLength(2);
    expect(harness.contexts[0]?.options).toEqual({ latencyHint: 'interactive' });
    expect(harness.contexts[1]?.options).toEqual({
      latencyHint: 'interactive',
      sampleRate: TRANSCRIPTION_SAMPLE_RATE,
    });
    expect(harness.contexts[0]?.source.connect).toHaveBeenCalledWith(
      harness.contexts[0]?.destination,
    );
    expect(harness.contexts[1]?.setSinkId).toHaveBeenCalledWith({ type: 'none' });
    expect(harness.workletConstructions[0]?.[2]).toEqual({
      channelCountMode: 'max',
      channelInterpretation: 'discrete',
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });

    const samples = Float32Array.from([0.25, -0.5]);
    harness.workletNodes[0]?.port.onmessage?.({
      data: samples.buffer,
    } as MessageEvent<ArrayBuffer>);
    expect(Array.from(onSamples.mock.calls[0]![0] as Float32Array)).toEqual([
      0.25, -0.5,
    ]);
  });

  it('falls back to a zero-gain destination when silent sink is rejected', async () => {
    const harness = createHarness({ rejectSilentSink: true });

    const pipeline = await createBrowserTabAudioPipeline('stream-id', vi.fn());

    expect(pipeline.sampleRate).toBe(TRANSCRIPTION_SAMPLE_RATE);
    expect(harness.workletNodes[0]?.connect).toHaveBeenCalledOnce();
  });

  it('exposes termination and closes every owned resource exactly once', async () => {
    const harness = createHarness();
    const pipeline = await createBrowserTabAudioPipeline('stream-id', vi.fn());
    const listener = vi.fn();
    pipeline.onEnded?.(listener);

    harness.endTrack();
    await pipeline.close();
    await pipeline.close();

    expect(listener).toHaveBeenCalledOnce();
    expect(harness.track.removeEventListener).toHaveBeenCalledWith(
      'ended',
      expect.any(Function),
    );
    expect(harness.track.stop).toHaveBeenCalledOnce();
    expect(harness.contexts[0]?.close).toHaveBeenCalledOnce();
    expect(harness.contexts[1]?.close).toHaveBeenCalledOnce();
    expect(harness.contexts[0]?.source.disconnect).toHaveBeenCalledOnce();
    expect(harness.contexts[1]?.source.disconnect).toHaveBeenCalledOnce();
    expect(harness.workletNodes[0]?.disconnect).toHaveBeenCalledOnce();
  });

  it('releases the captured track when AudioContext construction fails', async () => {
    const stop = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [
            { addEventListener: vi.fn(), removeEventListener, stop },
          ],
        }),
      },
    });
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('context failed');
        }
      },
    );

    await expect(
      createBrowserTabAudioPipeline('stream-id', vi.fn()),
    ).rejects.toThrow('context failed');
    expect(stop).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledOnce();
  });

  it('closes both contexts when worklet loading fails', async () => {
    const harness = createHarness({ rejectWorklet: true });

    await expect(
      createBrowserTabAudioPipeline('stream-id', vi.fn()),
    ).rejects.toThrow('worklet failed');

    expect(harness.track.stop).toHaveBeenCalledOnce();
    expect(harness.contexts[0]?.close).toHaveBeenCalledOnce();
    expect(harness.contexts[1]?.close).toHaveBeenCalledOnce();
  });

  it('rejects a browser context that does not honor 16 kHz', async () => {
    const harness = createHarness({ processingSampleRate: 48_000 });

    await expect(
      createBrowserTabAudioPipeline('stream-id', vi.fn()),
    ).rejects.toThrow('Unsupported transcription sample rate: 48000');

    expect(harness.track.stop).toHaveBeenCalledOnce();
    expect(harness.contexts[0]?.close).toHaveBeenCalledOnce();
    expect(harness.contexts[1]?.close).toHaveBeenCalledOnce();
  });
});
