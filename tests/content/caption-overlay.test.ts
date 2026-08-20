import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CaptionOverlay,
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

afterEach(() => vi.unstubAllGlobals());

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

describe('CaptionOverlay', () => {
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

  it('keeps the caption body click-through and renders four rounded corner handles', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance, layout);

    expect(shadow()?.querySelector('.caption-toolbar')).toBeInTheDocument();
    expect(shadow()?.querySelector('.toolbar-label')).toHaveTextContent('即時字幕');
    const css = shadow()?.querySelector('style')?.textContent;
    expect(css).toContain('height: 32px');
    expect(css).toContain('bottom: 100%');
    expect(css).toContain('height: 16px');
    expect(css).toContain('top: -42px');
    expect(css).toMatch(/\.captions\s*\{[^}]*pointer-events: none;/);
    expect(css).not.toContain('.captions::before');
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

  it('shows controls within the expanded proximity zone without a hit-test layer', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance, layout);
    const captions = shadow()?.querySelector<HTMLElement>('.captions')!;
    vi.spyOn(captions, 'getBoundingClientRect').mockReturnValue(
      rect(500, 200, 200, 240),
    );

    document.dispatchEvent(pointer('pointermove', 190, 200));
    expect(captions).toHaveClass('proximity-hover');

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
