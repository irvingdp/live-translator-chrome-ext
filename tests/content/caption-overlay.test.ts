import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CaptionOverlay,
  findLargestVisibleVideo,
} from '../../src/content/caption-overlay';

function rect(width: number, height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
}

const appearance = {
  backgroundOpacity: 50,
  bottomOffset: 12,
  maxLineWidth: 90,
  originalFontSize: 30,
  translationFontSize: 20,
};

function pairsOf(document: Document) {
  const host = document.querySelector('[data-bilingual-caption-root]');
  const track = host?.shadowRoot?.querySelector('.track');
  return [...(track?.children ?? [])].map((pair) => ({
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
  it('renders one element per window unit with both lines', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance);
    overlay.setWindow([
      { id: 'a', original: 'Hello there.', translation: '你好。' },
      { id: 'b', original: 'And now.', translation: '接下來。' },
    ]);

    expect(pairsOf(document)).toEqual([
      { id: 'a', original: 'Hello there.', translation: '你好。' },
      { id: 'b', original: 'And now.', translation: '接下來。' },
    ]);
  });

  it('applies appearance settings as CSS variables', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance);
    const host = document.querySelector<HTMLElement>(
      '[data-bilingual-caption-root]',
    );

    expect(host?.style.getPropertyValue('--caption-original-size')).toBe('30px');
    expect(host?.style.getPropertyValue('--caption-translation-size')).toBe(
      '20px',
    );
    expect(host?.style.getPropertyValue('--caption-bg-opacity')).toBe('0.5');
    expect(host?.style.getPropertyValue('--caption-bottom-offset')).toBe('12%');
  });

  it('sizes the box from the line-width setting so it stops resizing per caption', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show({ ...appearance, maxLineWidth: 60 });
    const host = document.querySelector<HTMLElement>('[data-bilingual-caption-root]');

    expect(host?.style.getPropertyValue('--caption-max-columns')).toBe('60');

    overlay.setAppearance({ ...appearance, maxLineWidth: 120 });

    expect(host?.style.getPropertyValue('--caption-max-columns')).toBe('120');
  });

  it('updates a unit in place without recreating its element', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance);
    overlay.setWindow([{ id: 'a', original: 'Hello', translation: '' }]);
    const host = document.querySelector('[data-bilingual-caption-root]');
    const before = host?.shadowRoot?.querySelector('.track')?.firstElementChild;

    overlay.setWindow([{ id: 'a', original: 'Hello there', translation: '你好' }]);

    expect(host?.shadowRoot?.querySelector('.track')?.firstElementChild).toBe(
      before,
    );
    expect(pairsOf(document)).toEqual([
      { id: 'a', original: 'Hello there', translation: '你好' },
    ]);
  });

  it('slides the track up and removes the outgoing unit when the window is full', async () => {
    vi.useFakeTimers();
    try {
      const overlay = new CaptionOverlay(document);
      overlay.show(appearance);
      overlay.setWindow([
        { id: 'a', original: 'A', translation: '甲' },
        { id: 'b', original: 'B', translation: '乙' },
      ]);

      overlay.setWindow([
        { id: 'b', original: 'B', translation: '乙' },
        { id: 'c', original: 'C', translation: '丙' },
      ]);

      const host = document.querySelector('[data-bilingual-caption-root]');
      const track = host?.shadowRoot?.querySelector<HTMLElement>('.track');
      expect(pairsOf(document).map((pair) => pair.id)).toEqual(['a', 'b', 'c']);
      expect(track?.classList.contains('instant')).toBe(true);

      await vi.advanceTimersByTimeAsync(400);

      expect(pairsOf(document).map((pair) => pair.id)).toEqual(['b', 'c']);
      expect(track?.classList.contains('instant')).toBe(false);
      expect(track?.style.transform).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('pins the box to its height from before the incoming unit was appended', async () => {
    vi.useFakeTimers();
    const heights = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains('pair')) return 10;
        if (this.classList.contains('viewport')) {
          return this.querySelectorAll('.pair').length * 10;
        }
        return 0;
      });
    try {
      const overlay = new CaptionOverlay(document);
      overlay.show(appearance);
      overlay.setWindow([
        { id: 'a', original: 'A', translation: '甲' },
        { id: 'b', original: 'B', translation: '乙' },
      ]);

      overlay.setWindow([
        { id: 'b', original: 'B', translation: '乙' },
        { id: 'c', original: 'C', translation: '丙' },
      ]);

      const viewport = document
        .querySelector('[data-bilingual-caption-root]')
        ?.shadowRoot?.querySelector<HTMLElement>('.viewport');
      const track = viewport?.querySelector<HTMLElement>('.track');
      // Two units tall. Pinning to the three-unit height the track briefly
      // has would let the box grow by exactly the unit the push hides.
      expect(viewport?.style.height).toBe('20px');
      expect(track?.style.transform).toBe('translateY(10px)');

      await vi.advanceTimersByTimeAsync(400);

      expect(viewport?.style.height).toBe('');
    } finally {
      heights.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not measure layout when a unit is only updated in place', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance);
    overlay.setWindow([{ id: 'a', original: 'A', translation: '' }]);
    const heights = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get');
    try {
      overlay.setWindow([{ id: 'a', original: 'A longer line', translation: '甲' }]);

      expect(heights).not.toHaveBeenCalled();
    } finally {
      heights.mockRestore();
    }
  });

  it('does not push when a unit only joins a window that was not full', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance);
    overlay.setWindow([{ id: 'a', original: 'A', translation: '甲' }]);

    overlay.setWindow([
      { id: 'a', original: 'A', translation: '甲' },
      { id: 'b', original: 'B', translation: '乙' },
    ]);

    const track = document
      .querySelector('[data-bilingual-caption-root]')
      ?.shadowRoot?.querySelector<HTMLElement>('.track');
    expect(pairsOf(document).map((pair) => pair.id)).toEqual(['a', 'b']);
    expect(track?.classList.contains('instant')).toBe(false);
    expect(track?.style.transform).toBe('');
  });

  it('drops outgoing units without a push when nothing was appended', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance);
    overlay.setWindow([
      { id: 'a', original: 'A', translation: '甲' },
      { id: 'b', original: 'B', translation: '乙' },
    ]);

    overlay.setWindow([]);

    expect(pairsOf(document)).toEqual([]);
  });

  it('leaves no orphaned elements after two pushes in a row', async () => {
    vi.useFakeTimers();
    try {
      const overlay = new CaptionOverlay(document);
      overlay.show(appearance);
      overlay.setWindow([
        { id: 'a', original: 'A', translation: '甲' },
        { id: 'b', original: 'B', translation: '乙' },
      ]);
      overlay.setWindow([
        { id: 'b', original: 'B', translation: '乙' },
        { id: 'c', original: 'C', translation: '丙' },
      ]);
      overlay.setWindow([
        { id: 'c', original: 'C', translation: '丙' },
        { id: 'd', original: 'D', translation: '丁' },
      ]);

      await vi.advanceTimersByTimeAsync(400);

      const track = document
        .querySelector('[data-bilingual-caption-root]')
        ?.shadowRoot?.querySelector<HTMLElement>('.track');
      expect(pairsOf(document).map((pair) => pair.id)).toEqual(['c', 'd']);
      expect(track?.classList.contains('instant')).toBe(false);
      expect(track?.style.transform).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('survives hiding while a push is still in flight', async () => {
    vi.useFakeTimers();
    try {
      const overlay = new CaptionOverlay(document);
      overlay.show(appearance);
      overlay.setWindow([
        { id: 'a', original: 'A', translation: '甲' },
        { id: 'b', original: 'B', translation: '乙' },
      ]);
      overlay.setWindow([
        { id: 'b', original: 'B', translation: '乙' },
        { id: 'c', original: 'C', translation: '丙' },
      ]);

      overlay.hide();
      // The pending push timer still holds references to the discarded host.
      await vi.advanceTimersByTimeAsync(400);

      overlay.show(appearance);
      expect(pairsOf(document)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the outgoing unit immediately when motion is reduced', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      const overlay = new CaptionOverlay(document);
      overlay.show(appearance);
      overlay.setWindow([
        { id: 'a', original: 'A', translation: '甲' },
        { id: 'b', original: 'B', translation: '乙' },
      ]);

      overlay.setWindow([
        { id: 'b', original: 'B', translation: '乙' },
        { id: 'c', original: 'C', translation: '丙' },
      ]);

      expect(pairsOf(document).map((pair) => pair.id)).toEqual(['b', 'c']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders a window that arrived before the overlay was shown', () => {
    const overlay = new CaptionOverlay(document);

    expect(() =>
      overlay.setWindow([{ id: 'a', original: 'Hello', translation: '你好' }]),
    ).not.toThrow();
    expect(document.querySelector('[data-bilingual-caption-root]')).toBeNull();

    overlay.show(appearance);

    expect(pairsOf(document)).toEqual([
      { id: 'a', original: 'Hello', translation: '你好' },
    ]);
  });

  it.each([
    ['invalid_credentials', 'DeepL API Key 無效，請到設定頁更新'],
    ['quota_exceeded', 'DeepL 本月翻譯額度已用完'],
    ['deepgram_disconnected', 'Deepgram 字幕連線中斷，請重新啟動'],
    ['translation_disabled', 'DeepL 連續失敗 5 次，本次字幕已停止翻譯'],
  ])('shows a specific message for %s', (code, expected) => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance);

    overlay.setSessionError(code);

    const host = document.documentElement.querySelector<HTMLElement>(
      '[data-bilingual-caption-root]',
    );
    expect(host?.shadowRoot?.querySelector('.status-message')?.textContent).toBe(
      expected,
    );
  });

  it('keeps circuit-open status visible while the window keeps updating', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance);
    overlay.setWindow([{ id: 'a', original: 'Good morning', translation: '' }]);
    overlay.setSessionError('translation_disabled');
    overlay.setWindow([
      { id: 'a', original: 'Good morning everyone', translation: '' },
    ]);

    const shadow = document.documentElement.querySelector<HTMLElement>(
      '[data-bilingual-caption-root]',
    )?.shadowRoot;
    expect(pairsOf(document)).toEqual([
      { id: 'a', original: 'Good morning everyone', translation: '' },
    ]);
    expect(shadow?.querySelector('.status-message')?.textContent).toBe(
      'DeepL 連續失敗 5 次，本次字幕已停止翻譯',
    );
  });

  it('clears a transient status without changing the window', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance);
    overlay.setWindow([
      { id: 'a', original: 'Good morning', translation: '早安' },
      { id: 'b', original: 'Everyone', translation: '各位' },
    ]);
    overlay.setSessionError('provider_unavailable');

    overlay.clearSessionError();

    const shadow = document.documentElement.querySelector<HTMLElement>(
      '[data-bilingual-caption-root]',
    )?.shadowRoot;
    expect(shadow?.querySelector('.status-message')?.textContent).toBe('');
    expect(pairsOf(document)).toEqual([
      { id: 'a', original: 'Good morning', translation: '早安' },
      { id: 'b', original: 'Everyone', translation: '各位' },
    ]);
  });

  it('removes the host completely when hidden', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance);

    overlay.hide();

    expect(
      document.documentElement.querySelector('[data-bilingual-caption-root]'),
    ).toBeNull();
  });

  it('leaves no stale units behind when shown again after hiding', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance);
    overlay.setWindow([
      { id: 'a', original: 'A', translation: '甲' },
      { id: 'b', original: 'B', translation: '乙' },
    ]);

    overlay.hide();
    overlay.show(appearance);

    expect(pairsOf(document)).toEqual([]);

    // A recycled id must still create a fresh element rather than resolve to
    // the discarded one left in the id map by the previous host.
    overlay.setWindow([{ id: 'a', original: 'A again', translation: '再甲' }]);

    expect(pairsOf(document)).toEqual([
      { id: 'a', original: 'A again', translation: '再甲' },
    ]);
  });

  it('moves the host into the fullscreen tree and restores it on exit', () => {
    const player = document.createElement('section');
    document.body.append(player);
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance);
    const host = document.documentElement.querySelector<HTMLElement>(
      '[data-bilingual-caption-root]',
    );

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: player,
    });
    overlay.position();
    expect(host?.parentElement).toBe(player);

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    });
    overlay.position();
    expect(host?.parentElement).toBe(document.documentElement);
  });

  it('uses a text track fallback for native video fullscreen', () => {
    const video = document.createElement('video');
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue(rect(1280, 720));
    const addCue = vi.fn();
    const removeCue = vi.fn();
    const track = { addCue, mode: 'disabled', removeCue };
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
    overlay.show(appearance);
    overlay.setWindow([
      { id: 'a', original: 'Good morning', translation: '早安' },
    ]);

    expect(track.mode).toBe('showing');
    expect(addCue).toHaveBeenCalledOnce();
    expect(addCue.mock.calls[0]?.[0].text).toBe('Good morning\n早安');
  });

  it('renders the whole window plus the status line in the text track cue', () => {
    const video = document.createElement('video');
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue(rect(1280, 720));
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
    overlay.show(appearance);
    overlay.setWindow([
      { id: 'a', original: 'Good morning', translation: '早安' },
      { id: 'b', original: 'Everyone', translation: '各位' },
    ]);
    overlay.setSessionError('translation_failed');

    const cue = addCue.mock.calls[0]?.[0];
    expect(cue.text.split('\n')).toEqual([
      'Good morning',
      '早安',
      'Everyone',
      '各位',
      'DeepL 翻譯失敗，英文字幕仍會繼續',
    ]);
  });
});
