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
  it('renders isolated bilingual captions with independent font sizes', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show({ originalFontSize: 28, translationFontSize: 20 });
    overlay.setOriginal('segment-1', 'Good morning');
    overlay.setTranslation({
      mode: 'append',
      segmentId: 'segment-1',
      text: '早安',
    });

    const host = document.documentElement.querySelector<HTMLElement>(
      '[data-bilingual-caption-root]',
    );
    expect(host?.shadowRoot?.textContent).toContain('Good morning');
    expect(host?.shadowRoot?.textContent).toContain('早安');
    expect(host?.style.getPropertyValue('--caption-original-size')).toBe('28px');
    expect(host?.style.getPropertyValue('--caption-translation-size')).toBe(
      '20px',
    );
  });

  it('appends stable translation chunks and replaces corrected segments', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show({ originalFontSize: 24, translationFontSize: 22 });
    overlay.setTranslation({
      mode: 'append',
      segmentId: 'segment-1',
      text: '早安',
    });
    overlay.setTranslation({
      mode: 'append',
      segmentId: 'segment-1',
      text: '大家',
    });

    expect(overlay.translationText()).toBe('早安 大家');

    overlay.setTranslation({
      mode: 'replace',
      segmentId: 'segment-1',
      text: '各位早安',
    });
    expect(overlay.translationText()).toBe('各位早安');
  });

  it.each([
    ['invalid_credentials', 'DeepL API Key 無效，請到設定頁更新'],
    ['quota_exceeded', 'DeepL 本月翻譯額度已用完'],
    ['deepgram_disconnected', 'Deepgram 字幕連線中斷，請重新啟動'],
  ])('shows a specific message for %s', (code, expected) => {
    const overlay = new CaptionOverlay(document);
    overlay.show({ originalFontSize: 24, translationFontSize: 22 });

    overlay.setSessionError(code);

    const host = document.documentElement.querySelector<HTMLElement>(
      '[data-bilingual-caption-root]',
    );
    expect(host?.shadowRoot?.querySelector('.original')?.textContent).toBe(
      expected,
    );
  });

  it('removes the host completely when hidden', () => {
    const overlay = new CaptionOverlay(document);
    overlay.show({ originalFontSize: 24, translationFontSize: 22 });

    overlay.hide();

    expect(
      document.documentElement.querySelector('[data-bilingual-caption-root]'),
    ).toBeNull();
  });

  it('moves the host into the fullscreen tree and restores it on exit', () => {
    const player = document.createElement('section');
    document.body.append(player);
    const overlay = new CaptionOverlay(document);
    overlay.show({ originalFontSize: 24, translationFontSize: 22 });
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
    overlay.show({ originalFontSize: 24, translationFontSize: 22 });
    overlay.setOriginal('segment-1', 'Good morning');
    overlay.setTranslation({
      mode: 'append',
      segmentId: 'segment-1',
      text: '早安',
    });

    expect(track.mode).toBe('showing');
    expect(addCue).toHaveBeenCalledOnce();
    expect(addCue.mock.calls[0]?.[0].text).toBe('Good morning\n早安');
  });
});
