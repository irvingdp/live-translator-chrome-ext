import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayerControlResponse } from '../../src/core/player-control';
import {
  findPlayerToolbar,
  PlayerToggleController,
} from '../../src/content/player-toggle';

function rect(width: number, height: number, left = 0, top = 0): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON: () => ({}),
    top,
    width,
    x: left,
    y: top,
  };
}

let receive: (message: PlayerControlResponse) => void;
let posted: ReturnType<typeof vi.fn>;

beforeEach(() => {
  posted = vi.fn();
  vi.stubGlobal('MutationObserver', class {
    disconnect = vi.fn();
    observe = vi.fn();
  });
  vi.stubGlobal('ResizeObserver', class {
    disconnect = vi.fn();
    observe = vi.fn();
  });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
  vi.stubGlobal('chrome', {
    i18n: {
      getMessage: vi.fn((key: string) => key),
    },
    runtime: {
      connect: vi.fn(() => ({
        disconnect: vi.fn(),
        onDisconnect: { addListener: vi.fn() },
        onMessage: {
          addListener: vi.fn((listener: typeof receive) => { receive = listener; }),
        },
        postMessage: posted,
      })),
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.documentElement
    .querySelectorAll('[data-bilingual-player-toggle]')
    .forEach((element) => element.remove());
});

describe('player toggle controls', () => {
  it('finds the right-hand control group containing the fullscreen action', () => {
    const video = document.createElement('video');
    const toolbar = document.createElement('div');
    const leftControls = document.createElement('div');
    const rightControls = document.createElement('div');
    const play = document.createElement('button');
    const settings = document.createElement('button');
    const fullscreen = document.createElement('button');
    play.setAttribute('aria-label', 'Play');
    settings.setAttribute('aria-label', 'Settings');
    fullscreen.setAttribute('aria-label', 'Fullscreen');
    leftControls.append(play);
    rightControls.append(settings, fullscreen);
    toolbar.append(leftControls, rightControls);
    document.body.append(video, toolbar);
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue(rect(1000, 600));
    vi.spyOn(rightControls, 'getBoundingClientRect').mockReturnValue(
      rect(1000, 50, 0, 550),
    );

    expect(findPlayerToolbar(document, video)).toBe(rightControls);
  });

  it('renders one floating fallback with the packaged extension icon', async () => {
    const video = document.createElement('video');
    document.body.append(video);
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue(
      rect(1000, 600, 20, 30),
    );

    const controller = new PlayerToggleController(document);
    controller.start();
    await vi.waitFor(() => expect(posted).toHaveBeenCalledWith({
      type: 'PLAYER_CANDIDATE',
      payload: { area: 600000, kind: 'video' },
    }));
    receive({
      type: 'PLAYER_SELECTION',
      payload: {
        selected: true,
        state: { active: false, busy: false },
      },
    });

    const host = document.documentElement.querySelector<HTMLElement>(
      '[data-bilingual-player-toggle="floating"]',
    );
    const button = host?.shadowRoot?.querySelector('button');
    expect(host).toBeTruthy();
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button?.querySelector('img')).toHaveAttribute(
      'src',
      'chrome-extension://test/icon/32.png',
    );

    receive({
      type: 'PLAYER_STATE',
      payload: { active: true, busy: false },
    });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button?.querySelector('img')?.style.filter).toContain('brightness(1.18)');

    receive({
      type: 'PLAYER_TOGGLE_RESULT',
      payload: { error: 'needs_toolbar_grant', ok: false },
    });
    expect(document.querySelector('[data-bilingual-player-guidance]'))
      .toHaveTextContent('playerToggleNeedsToolbarGrant');

    vi.mocked(chrome.i18n.getMessage).mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    receive({
      type: 'PLAYER_STATE',
      payload: { active: false, busy: false },
    });
    expect(document.querySelector('[data-bilingual-player-toggle]')).toBeNull();
    controller.stop();
  });

  it('inserts the icon before existing controls when a toolbar is available', async () => {
    const video = document.createElement('video');
    const toolbar = document.createElement('div');
    const leftControls = document.createElement('div');
    const rightControls = document.createElement('div');
    const play = document.createElement('button');
    const settings = document.createElement('button');
    const fullscreen = document.createElement('button');
    play.setAttribute('aria-label', 'Pause');
    settings.setAttribute('aria-label', 'Settings');
    fullscreen.setAttribute('aria-label', 'Enter fullscreen');
    leftControls.append(play);
    rightControls.append(settings, fullscreen);
    toolbar.append(leftControls, rightControls);
    document.body.append(video, toolbar);
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue(rect(900, 500));
    vi.spyOn(rightControls, 'getBoundingClientRect').mockReturnValue(
      rect(900, 45, 0, 455),
    );

    const controller = new PlayerToggleController(document);
    controller.start();
    await vi.waitFor(() => expect(posted).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PLAYER_CANDIDATE' }),
    ));
    receive({
      type: 'PLAYER_SELECTION',
      payload: {
        selected: true,
        state: { active: false, busy: false },
      },
    });

    expect(rightControls.firstElementChild).toHaveAttribute(
      'data-bilingual-caption-toggle',
      'true',
    );
    controller.stop();
  });
});
