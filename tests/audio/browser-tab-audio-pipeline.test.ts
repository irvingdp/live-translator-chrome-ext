import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserTabAudioPipeline } from '../../src/audio/browser-tab-audio-pipeline';

afterEach(() => vi.unstubAllGlobals());

describe('createBrowserTabAudioPipeline', () => {
  it('exposes captured-track termination to the session controller', async () => {
    let ended: (() => void) | undefined;
    const track = {
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        ended = listener;
      }),
      removeEventListener: vi.fn(),
      stop: vi.fn(),
    };
    const node = {
      connect: vi.fn().mockReturnThis(),
      disconnect: vi.fn(),
      gain: { value: 1 },
      port: { onmessage: null },
    };
    class WorkingAudioContext {
      sampleRate = 48_000;
      destination = node;
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      createMediaStreamSource = vi.fn(() => node);
      createGain = vi.fn(() => node);
      close = vi.fn().mockResolvedValue(undefined);
    }
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }),
      },
    });
    vi.stubGlobal('AudioContext', WorkingAudioContext);
    vi.stubGlobal('AudioWorkletNode', class { constructor() { return node; } });
    vi.stubGlobal('chrome', {
      runtime: { getURL: (path: string) => `chrome-extension://id/${path}` },
    });
    const pipeline = await createBrowserTabAudioPipeline('stream-id', vi.fn());
    const listener = vi.fn();
    pipeline.onEnded?.(listener);

    ended?.();

    expect(listener).toHaveBeenCalledOnce();
  });

  it('releases the captured track when AudioContext construction fails', async () => {
    const stop = vi.fn();
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop }],
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
  });

  it('releases the captured track and AudioContext when worklet loading fails', async () => {
    const stop = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop }],
    });
    class FailingAudioContext {
      readonly audioWorklet = {
        addModule: vi.fn().mockRejectedValue(new Error('worklet failed')),
      };
      readonly close = close;
    }
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('AudioContext', FailingAudioContext);
    vi.stubGlobal('chrome', {
      runtime: { getURL: (path: string) => `chrome-extension://id/${path}` },
    });

    await expect(
      createBrowserTabAudioPipeline('stream-id', vi.fn()),
    ).rejects.toThrow('worklet failed');

    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
