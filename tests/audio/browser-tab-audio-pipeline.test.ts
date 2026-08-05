import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserTabAudioPipeline } from '../../src/audio/browser-tab-audio-pipeline';

afterEach(() => vi.unstubAllGlobals());

describe('createBrowserTabAudioPipeline', () => {
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
