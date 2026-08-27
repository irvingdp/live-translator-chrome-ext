import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CaptionOverlay,
  findLargestVisiblePlayerFrame,
  findLargestVisibleVideo,
} from '../../src/content/caption-overlay';
import type { OverlayLayout } from '../../src/core/overlay-layout';

function rect(
  width: number,
  height: number,
  left = 0,
  top = 0,
): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

const appearance = {
  backgroundOpacity: 50,
  originalFontSize: 30,
  originalTextColor: '#e2e8f0',
  translationFontSize: 20,
  translationTextColor: '#facc15',
};

const layout: OverlayLayout = {
  floatingRect: {
    heightRatio: 0.25,
    widthRatio: 0.5,
    xRatio: 0.2,
    yRatio: 0.3,
  },
  mode: 'floating',
  version: 1,
};

function shadow() {
  return document.querySelector<HTMLElement>('[data-bilingual-caption-root]')
    ?.shadowRoot;
}

function pairsOf() {
  return [...(shadow()?.querySelector('.track')?.children ?? [])].map((pair) => ({
    hidden: (pair as HTMLElement).dataset.hidden,
    id: (pair as HTMLElement).dataset.pairId,
    original: pair.querySelector('.original')?.textContent,
    translation: pair.querySelector('.translation')?.textContent,
  }));
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  document.body.replaceChildren();
  document.documentElement
    .querySelectorAll('[data-bilingual-caption-root]')
    .forEach((element) => element.remove());
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    value: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('findLargestVisibleVideo', () => {
  it('selects the largest visible HTML video', () => {
    const small = document.createElement('video');
    const large = document.createElement('video');
    vi.spyOn(small, 'getBoundingClientRect').mockReturnValue(rect(320, 180));
    vi.spyOn(large, 'getBoundingClientRect').mockReturnValue(rect(1280, 720));
    document.body.append(small, large);

    expect(findLargestVisibleVideo(document)).toBe(large);
  });

  it('ignores zero-area videos', () => {
    const hidden = document.createElement('video');
    vi.spyOn(hidden, 'getBoundingClientRect').mockReturnValue(rect(0, 0));
    document.body.append(hidden);

    expect(findLargestVisibleVideo(document)).toBeUndefined();
  });
});

describe('findLargestVisiblePlayerFrame', () => {
  it('prefers a large player iframe over banner and hidden frames', () => {
    const player = document.createElement('iframe');
    player.src = 'https://jav.sb/static/player/videojs.html?token=secret';
    const banner = document.createElement('iframe');
    banner.src = 'https://jav.sb/videojs/strip.php';
    const hidden = document.createElement('iframe');
    hidden.src = 'https://jav.sb/videojs/player.html';
    vi.spyOn(player, 'getBoundingClientRect').mockReturnValue(
      rect(800, 450, 100, -410),
    );
    vi.spyOn(banner, 'getBoundingClientRect').mockReturnValue(
      rect(900, 100, 50, 600),
    );
    vi.spyOn(hidden, 'getBoundingClientRect').mockReturnValue(rect(0, 0));
    document.body.append(player, banner, hidden);

    expect(findLargestVisiblePlayerFrame(document)).toBe(player);
  });

  it('accepts an unlabelled iframe with a video-shaped rectangle', () => {
    const frame = document.createElement('iframe');
    frame.src = 'https://media.example/content.html';
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(
      rect(640, 360, 100, 100),
    );
    document.body.append(frame);

    expect(findLargestVisiblePlayerFrame(document)).toBe(frame);
  });
});

describe('CaptionOverlay', () => {
  it('adjusts both font sizes and background opacity from the hover toolbar', () => {
    const onAppearanceChanged = vi.fn();
    const overlay = new CaptionOverlay(document, { onAppearanceChanged });
    overlay.show(appearance, layout);

    const buttons = shadow()?.querySelectorAll<HTMLButtonElement>(
      '[data-appearance-action]',
    );
    expect([...buttons ?? []].map((button) => button.getAttribute('aria-label'))).toEqual([
      '同時加大原文與譯文字體',
      '同時縮小原文與譯文字體',
      '增加字幕背景透明度',
      '減少字幕背景透明度',
    ]);
    expect([...buttons ?? []].every((button) => button.querySelector('svg')))
      .toBe(true);
    expect([...buttons ?? []].map((button) =>
      button.querySelector('.appearance-symbol')?.textContent
    )).toEqual(['+', '−', '+', '−']);
    expect([...buttons ?? []].every((button) =>
      button.classList.contains('symbol-appearance-button')
    )).toBe(true);

    const pointerDown = new Event('pointerdown', {
      bubbles: true,
      cancelable: true,
    });
    buttons?.[0]?.dispatchEvent(pointerDown);
    expect(pointerDown.defaultPrevented).toBe(true);

    shadow()?.querySelector<HTMLButtonElement>(
      '[data-appearance-action="font-increase"]',
    )?.click();
    expect(onAppearanceChanged).toHaveBeenLastCalledWith({
      ...appearance,
      originalFontSize: 31,
      translationFontSize: 21,
    });

    shadow()?.querySelector<HTMLButtonElement>(
      '[data-appearance-action="background-decrease"]',
    )?.click();
    expect(onAppearanceChanged).toHaveBeenLastCalledWith({
      ...appearance,
      backgroundOpacity: 45,
      originalFontSize: 31,
      translationFontSize: 21,
    });

    const fontButton = buttons?.[0];
    fontButton?.focus();
    expect(shadow()?.activeElement).toBe(fontButton);
    fontButton?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      detail: 1,
    }));
    expect(shadow()?.activeElement).not.toBe(fontButton);
  });

  it('renders bilingual pairs and only visual appearance variables', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance, layout);
    overlay.setWindow([
      { id: 'a', original: 'Hello there.', translation: '你好。' },
      { id: 'b', original: 'And now.', translation: '接下來。' },
    ]);
    const host = document.querySelector<HTMLElement>('[data-bilingual-caption-root]');

    expect(pairsOf()).toEqual([
      { hidden: 'false', id: 'a', original: 'Hello there.', translation: '你好。' },
      { hidden: 'false', id: 'b', original: 'And now.', translation: '接下來。' },
    ]);
    expect(host?.style.getPropertyValue('--caption-original-size')).toBe('30px');
    expect(host?.style.getPropertyValue('--caption-original-color')).toBe('#e2e8f0');
    expect(host?.style.getPropertyValue('--caption-translation-size')).toBe('20px');
    expect(host?.style.getPropertyValue('--caption-translation-color')).toBe('#facc15');
    expect(host?.style.getPropertyValue('--caption-bg-opacity')).toBe('0.5');
    expect(host?.style.getPropertyValue('--caption-width')).toBe('');
  });

  it('supports direct hover over iframe players and renders four rounded corner handles', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance, layout);

    expect(shadow()?.querySelector('.caption-toolbar')).toBeInTheDocument();
    expect(shadow()?.querySelector('.toolbar-label')).toHaveTextContent('即時字幕');
    const css = shadow()?.querySelector('style')?.textContent;
    expect(css).toContain('height: 32px');
    expect(css).toContain('bottom: 100%');
    expect(css).toContain('height: 16px');
    expect(css).toContain('var(--caption-original-size, 16px)');
    expect(css).toContain('var(--caption-translation-size, 16px)');
    expect(css).toContain('var(--caption-bg-opacity, 0)');
    expect(css).toMatch(/\.caption-body\s*\{[^}]*border: 0;/);
    expect(css).toMatch(/\.caption-body\s*\{[^}]*box-shadow: none;/);
    expect(css).not.toContain('0 8px 28px rgba(0, 0, 0, 0.34)');
    expect(css).toContain('top: -42px');
    expect(css).toMatch(/\.captions\s*\{[^}]*pointer-events: none;/);
    expect(css).toMatch(/\.caption-body\s*\{[^}]*pointer-events: auto;/);
    expect(css).not.toContain('.captions::before');
    expect(css).toContain('.captions:hover .caption-toolbar');
    expect(css).toContain('.captions.proximity-hover .caption-toolbar');
    expect(css).toContain('border-left: 5px solid #5eead4');
    expect(shadow()?.querySelectorAll('.resize-handle')).toHaveLength(4);
    expect([...shadow()!.querySelectorAll<HTMLElement>('.resize-handle')].map(
      (handle) => handle.dataset.resizeDirection,
    )).toEqual(['nw', 'ne', 'se', 'sw']);
    expect(shadow()?.querySelector('.side-panel-button')).toHaveAttribute(
      'aria-label',
      '在側邊面板顯示字幕',
    );
  });

  it('makes the caption background transparent at zero opacity without a border', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show({ ...appearance, backgroundOpacity: 0 }, layout);
    const host = document.querySelector<HTMLElement>(
      '[data-bilingual-caption-root]',
    );

    expect(host?.style.getPropertyValue('--caption-bg-opacity')).toBe('0');
    const css = shadow()?.querySelector('style')?.textContent;
    expect(css).toMatch(/\.caption-body\s*\{[^}]*border: 0;/);
    expect(css).toMatch(/\.caption-body\s*\{[^}]*box-shadow: none;/);
  });

  it('shows controls within the expanded proximity zone without a hit-test layer', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance, layout);
    const captions = shadow()?.querySelector<HTMLElement>('.captions')!;
    vi.spyOn(captions, 'getBoundingClientRect').mockReturnValue(
      rect(500, 200, 200, 240),
    );

    document.dispatchEvent(pointer('pointermove', 190, 200));
    expect(captions).toHaveClass('proximity-hover');

    captions.dispatchEvent(pointer('pointerleave', 800, 700));
    expect(captions).not.toHaveClass('proximity-hover');

    document.dispatchEvent(pointer('pointermove', 190, 200));
    document.dispatchEvent(pointer('pointermove', 100, 100));
    expect(captions).not.toHaveClass('proximity-hover');
  });

  it('applies the saved viewport-relative rectangle', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance, layout);
    const captions = shadow()?.querySelector<HTMLElement>('.captions');

    expect(captions?.style.left).toBe('200px');
    expect(captions?.style.top).toBe('240px');
    expect(captions?.style.width).toBe('500px');
    expect(captions?.style.height).toBe('200px');
  });

  it('centres a fresh layout near the bottom of the largest video', () => {
    const video = document.createElement('video');
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue(
      rect(800, 450, 100, 100),
    );
    document.body.append(video);
    const overlay = new CaptionOverlay(document);

    overlay.show(appearance);

    const current = overlay.currentLayout().floatingRect;
    expect(current.widthRatio).toBeCloseTo(0.56);
    expect(current.heightRatio).toBeCloseTo(0.225);
    expect(current.xRatio).toBeCloseTo(0.22);
    expect(current.yRatio).toBeCloseTo(0.44);
  });

  it('repositions a saved rectangle at the video bottom at 70% video width', async () => {
    const video = document.createElement('video');
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue(
      rect(800, 450, 100, 100),
    );
    document.body.append(video);
    const onLayoutChanged = vi.fn();
    const overlay = new CaptionOverlay(document, { onLayoutChanged });

    overlay.show(appearance, layout, 'video-bottom');

    const current = overlay.currentLayout().floatingRect;
    expect(current.widthRatio).toBeCloseTo(0.56);
    expect(current.heightRatio).toBeCloseTo(layout.floatingRect.heightRatio);
    expect(current.xRatio).toBeCloseTo(0.22);
    expect(current.yRatio).toBeCloseTo(0.415);
    expect(console.info).toHaveBeenCalledWith(
      '[Bilingual Captions][placement-debug]',
      'computed video-bottom layout',
      expect.objectContaining({
        fallbackReason: undefined,
        selection: 'top-level-video',
        selectedVideo: expect.objectContaining({
          rect: { height: 450, left: 100, top: 100, width: 800 },
        }),
      }),
    );
    await vi.waitFor(() => expect(onLayoutChanged).toHaveBeenCalledWith(
      overlay.currentLayout(),
    ));
  });

  it('uses a player iframe as the video bounds when no top-level video exists', () => {
    const frame = document.createElement('iframe');
    frame.src = 'https://jav.sb/static/player/videojs.html?token=secret';
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(
      rect(800, 450, 100, 100),
    );
    document.body.append(frame);
    const overlay = new CaptionOverlay(document);

    overlay.show(appearance, layout, 'video-bottom');

    const current = overlay.currentLayout().floatingRect;
    expect(current.widthRatio).toBeCloseTo(0.56);
    expect(current.heightRatio).toBeCloseTo(layout.floatingRect.heightRatio);
    expect(current.xRatio).toBeCloseTo(0.22);
    expect(current.yRatio).toBeCloseTo(0.415);
    expect(console.info).toHaveBeenCalledWith(
      '[Bilingual Captions][placement-debug]',
      'computed video-bottom layout',
      expect.objectContaining({
        fallbackReason: undefined,
        iframeCandidates: [expect.objectContaining({
          rect: { height: 450, left: 100, top: 100, width: 800 },
          src: 'https://jav.sb/static/player/videojs.html',
        })],
        selectedPlayerFrame: expect.objectContaining({
          rect: { height: 450, left: 100, top: 100, width: 800 },
          src: 'https://jav.sb/static/player/videojs.html',
        }),
        selectedVideo: undefined,
        selection: 'player-iframe',
        topLevelVideos: [],
      }),
    );
  });

  it('keeps the caption at the same position relative to the video while scrolling', () => {
    const video = document.createElement('video');
    let videoTop = 100;
    vi.spyOn(video, 'getBoundingClientRect').mockImplementation(() =>
      rect(800, 450, 100, videoTop)
    );
    document.body.append(video);
    const overlay = new CaptionOverlay(document);

    overlay.show(appearance, layout, 'video-bottom');
    const captions = shadow()?.querySelector<HTMLElement>('.captions')!;
    const initialTop = Number.parseFloat(captions.style.top);

    videoTop = -100;
    overlay.position();

    expect(Number.parseFloat(captions.style.top)).toBeCloseTo(initialTop - 200);
    expect(Number.parseFloat(captions.style.left)).toBeGreaterThanOrEqual(110);
    expect(
      Number.parseFloat(captions.style.left) +
      Number.parseFloat(captions.style.width),
    ).toBeLessThanOrEqual(890);
  });

  it('uses the viewport bottom when no video or player iframe exists', () => {
    const overlay = new CaptionOverlay(document);

    overlay.show(appearance, layout, 'video-bottom');

    const current = overlay.currentLayout().floatingRect;
    expect(current.widthRatio).toBeCloseTo(0.7);
    expect(current.xRatio).toBeCloseTo(0.15);
    expect(current.yRatio).toBeCloseTo(0.67);
    expect(console.info).toHaveBeenCalledWith(
      '[Bilingual Captions][placement-debug]',
      'computed video-bottom layout',
      expect.objectContaining({
        fallbackReason: 'no-top-level-video-or-player-iframe',
        selectedPlayerFrame: undefined,
        selectedVideo: undefined,
        selection: 'viewport-fallback',
      }),
    );
  });

  it('persists a drag only after pointer release', () => {
    const onLayoutChanged = vi.fn();
    const overlay = new CaptionOverlay(document, { onLayoutChanged });
    overlay.show(appearance, layout);
    const captions = shadow()?.querySelector<HTMLElement>('.captions')!;
    Object.assign(captions, {
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn(),
    });

    shadow()?.querySelector<HTMLElement>('.drag-region')
      ?.dispatchEvent(pointer('pointerdown', 220, 260));
    captions.dispatchEvent(pointer('pointerup', 320, 360));

    expect(onLayoutChanged).toHaveBeenCalledOnce();
    expect(onLayoutChanged.mock.calls[0]![0].floatingRect).toMatchObject({
      xRatio: 0.3,
      yRatio: 0.425,
    });
  });

  it('does not drag from the caption body', () => {
    const onLayoutChanged = vi.fn();
    const overlay = new CaptionOverlay(document, { onLayoutChanged });
    overlay.show(appearance, layout);
    const captions = shadow()?.querySelector<HTMLElement>('.captions')!;
    Object.assign(captions, {
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn(),
    });

    shadow()?.querySelector<HTMLElement>('.caption-body')
      ?.dispatchEvent(pointer('pointerdown', 220, 260));
    captions.dispatchEvent(pointer('pointerup', 320, 360));

    expect(onLayoutChanged).not.toHaveBeenCalled();
    expect(overlay.currentLayout().floatingRect).toEqual(layout.floatingRect);
  });

  it('resizes from a corner and enforces the 80px minimum content height', () => {
    const onLayoutChanged = vi.fn();
    const overlay = new CaptionOverlay(document, { onLayoutChanged });
    overlay.show(appearance, layout);
    const captions = shadow()?.querySelector<HTMLElement>('.captions')!;
    const southEast = shadow()?.querySelector<HTMLElement>('.resize-se')!;
    Object.assign(captions, {
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn(),
    });

    southEast.dispatchEvent(pointer('pointerdown', 700, 440));
    captions.dispatchEvent(pointer('pointerup', 500, 250));

    const changed = onLayoutChanged.mock.calls[0]![0] as OverlayLayout;
    expect(changed.floatingRect.heightRatio).toBeCloseTo(0.1);
  });

  it('hides only complete older pairs when height is exhausted', () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains('viewport') ? 45 : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains('pair') ? 20 : 0;
      },
    );
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance, layout);
    overlay.setWindow(['a', 'b', 'c'].map((id) => ({
      id,
      original: id.toUpperCase(),
      translation: id,
    })));

    expect(pairsOf().map(({ id, hidden }) => ({ id, hidden }))).toEqual([
      { hidden: 'true', id: 'a' },
      { hidden: 'false', id: 'b' },
      { hidden: 'false', id: 'c' },
    ]);
  });

  it('opens the native panel and hides the webpage overlay', async () => {
    const onOpenSidePanel = vi.fn().mockResolvedValue(undefined);
    const overlay = new CaptionOverlay(document, { onOpenSidePanel });
    overlay.show(appearance, layout);

    shadow()?.querySelector<HTMLButtonElement>('.side-panel-button')?.click();
    await Promise.resolve();

    expect(onOpenSidePanel).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'native' }),
    );
    expect(document.querySelector<HTMLElement>('[data-bilingual-caption-root]')?.style.display)
      .toBe('none');
  });

  it('renders a window that arrived before the overlay was shown', () => {
    const overlay = new CaptionOverlay(document);
    overlay.setWindow([{ id: 'a', original: 'Hello', translation: '你好' }]);
    overlay.show(appearance, layout);

    expect(pairsOf()[0]).toMatchObject({
      id: 'a',
      original: 'Hello',
      translation: '你好',
    });
  });

  it('shows and clears a translated session error', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance, layout);
    overlay.setSessionError('translation_disabled');
    expect(shadow()?.querySelector('.status-message')?.textContent).toBe(
      'DeepL 連續失敗 5 次，本次字幕已停止翻譯',
    );

    overlay.clearSessionError();
    expect(shadow()?.querySelector('.status-message')?.textContent).toBe('');
  });

  it('moves into an element fullscreen tree', () => {
    const player = document.createElement('section');
    document.body.append(player);
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance, layout);
    const host = document.querySelector<HTMLElement>('[data-bilingual-caption-root]');
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: player,
    });

    overlay.position();

    expect(host?.parentElement).toBe(player);
  });

  it('moves into the actual fullscreen player inside a same-origin iframe', () => {
    const player = document.createElement('iframe');
    document.body.append(player);
    const framePlayer = player.contentDocument!.createElement('section');
    player.contentDocument!.body.append(framePlayer);
    Object.defineProperty(player.contentDocument, 'fullscreenElement', {
      configurable: true,
      value: framePlayer,
    });
    const onLayoutChanged = vi.fn();
    const overlay = new CaptionOverlay(document, { onLayoutChanged });
    overlay.show(appearance, layout);
    const host = document.querySelector<HTMLElement>('[data-bilingual-caption-root]');
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: player,
    });

    overlay.position();

    expect(host?.parentElement).toBe(framePlayer);
    expect(host?.isConnected).toBe(true);

    const captions = host?.shadowRoot?.querySelector<HTMLElement>('.captions')!;
    Object.assign(captions, {
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn(),
    });
    const oldHandle = host?.shadowRoot?.querySelector('.resize-se')!;
    const frameHandle = player.contentDocument!.createElement('span');
    frameHandle.className = 'resize-handle resize-se';
    frameHandle.dataset.resizeDirection = 'se';
    oldHandle.replaceWith(frameHandle);
    const framePointer = (type: string, x: number, y: number) => {
      const FrameMouseEvent = (
        player.contentWindow as Window & typeof globalThis
      ).MouseEvent;
      const event = new FrameMouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
      });
      Object.defineProperty(event, 'pointerId', { value: 7 });
      return event;
    };

    frameHandle.dispatchEvent(framePointer('pointerdown', 700, 440));
    captions.dispatchEvent(framePointer('pointerup', 650, 400));

    expect(onLayoutChanged).toHaveBeenCalledOnce();

    Object.defineProperty(player.contentDocument, 'fullscreenElement', {
      configurable: true,
      value: null,
    });
    // The outer document can lag behind the iframe during fullscreen exit.
    overlay.position();
    expect(host?.parentElement).toBe(document.body);
  });

  it('keeps the overlay in body when the document element is fullscreen', () => {
    const overlay = new CaptionOverlay(document);

    overlay.show(appearance, layout);
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.documentElement,
    });
    overlay.position();

    const host = document.querySelector('[data-bilingual-caption-root]');
    expect(host?.parentElement).toBe(document.body);
  });

  it('keeps the host detached throughout a fullscreen transition', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance, layout);
    const host = document.querySelector<HTMLElement>('[data-bilingual-caption-root]');

    overlay.suspendForFullscreenTransition();
    overlay.position();
    expect(host?.isConnected).toBe(false);

    overlay.resumeAfterFullscreenTransition();
    expect(host?.parentElement).toBe(document.body);
  });

  it('uses a text track fallback for native video fullscreen', () => {
    const video = document.createElement('video');
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue(rect(1000, 800));
    const addCue = vi.fn();
    const track = { addCue, mode: 'disabled', removeCue: vi.fn() };
    Object.defineProperty(video, 'addTextTrack', { value: vi.fn(() => track) });
    class FakeCue {
      constructor(
        public startTime: number,
        public endTime: number,
        public text: string,
      ) {}
    }
    vi.stubGlobal('VTTCue', FakeCue);
    document.body.append(video);
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: video,
    });
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance, layout);
    overlay.setWindow([
      { id: 'a', original: 'Good morning', translation: '早安' },
    ]);

    expect(track.mode).toBe('showing');
    expect(addCue.mock.calls[0]?.[0].text).toBe('Good morning\n早安');
  });
});

function pointer(type: string, clientX: number, clientY: number): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX,
    clientY,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}
