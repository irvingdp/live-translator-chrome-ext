import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installMediaPlaybackWatcher,
  isPrimaryVideoPlaying,
} from '../../src/content/media-playback-watcher';

let receiveMessage: (
  message: { type: string },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean;
let sendMessage: ReturnType<typeof vi.fn>;

function playingVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperties(video, {
    ended: { configurable: true, value: false },
    paused: { configurable: true, value: false },
  });
  video.getBoundingClientRect = () => ({
    bottom: 450,
    height: 400,
    left: 0,
    right: 700,
    top: 50,
    width: 700,
    x: 0,
    y: 50,
    toJSON: () => ({}),
  });
  document.body.append(video);
  return video;
}

beforeEach(() => {
  document.body.replaceChildren();
  sendMessage = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: typeof receiveMessage) => {
          receiveMessage = listener;
        }),
        removeListener: vi.fn(),
      },
      sendMessage,
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('media playback watcher', () => {
  it('reports the largest visible video when it starts playing', async () => {
    const video = playingVideo();
    const uninstall = installMediaPlaybackWatcher(document);
    sendMessage.mockClear();

    video.dispatchEvent(new Event('play'));

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      target: 'background',
      type: 'MEDIA_PLAYING',
    }));
    uninstall();
  });

  it('answers whether the primary visible video is already playing', () => {
    playingVideo();
    const uninstall = installMediaPlaybackWatcher(document);
    const respond = vi.fn();

    expect(receiveMessage(
      { type: 'MEDIA_PLAYBACK_STATUS' },
      {},
      respond,
    )).toBe(false);
    expect(respond).toHaveBeenCalledWith({ playing: true });
    expect(isPrimaryVideoPlaying(document)).toBe(true);
    uninstall();
  });
});
