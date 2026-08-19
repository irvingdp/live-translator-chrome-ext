import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OVERLAY_LAYOUT,
  httpsOrigin,
  layoutForOrigin,
  MAX_SAVED_ORIGINS,
  normalizeOverlayLayout,
  saveLayoutForOrigin,
} from '../../src/core/overlay-layout';

describe('overlay layout persistence', () => {
  it('normalizes malformed rectangles into the viewport', () => {
    const normalized = normalizeOverlayLayout({
      floatingRect: {
        heightRatio: 0.4,
        widthRatio: 0.8,
        xRatio: 0.9,
        yRatio: -1,
      },
      mode: 'native',
    });
    expect(normalized).toEqual({
      floatingRect: {
        heightRatio: 0.4,
        widthRatio: 0.8,
        xRatio: expect.closeTo(0.2),
        yRatio: 0,
      },
      mode: 'native',
      version: 1,
    });

    expect(normalizeOverlayLayout(null)).toEqual(DEFAULT_OVERLAY_LAYOUT);
  });

  it('keeps independent layouts for each HTTPS origin', () => {
    const first = saveLayoutForOrigin(undefined, 'https://video.example', {
      ...DEFAULT_OVERLAY_LAYOUT,
      floatingRect: {
        heightRatio: 0.3,
        widthRatio: 0.6,
        xRatio: 0.1,
        yRatio: 0.2,
      },
    });
    const second = saveLayoutForOrigin(first, 'https://meet.example', {
      ...DEFAULT_OVERLAY_LAYOUT,
      mode: 'native',
    });

    expect(layoutForOrigin(second, 'https://video.example')?.floatingRect.xRatio)
      .toBe(0.1);
    expect(layoutForOrigin(second, 'https://meet.example')?.mode).toBe('native');
  });

  it('rejects non-HTTPS keys and bounds saved origins', () => {
    let store = saveLayoutForOrigin(undefined, 'http://unsafe.example', {});
    expect(store.order).toEqual([]);

    for (let index = 0; index <= MAX_SAVED_ORIGINS; index += 1) {
      store = saveLayoutForOrigin(
        store,
        `https://site-${index}.example`,
        DEFAULT_OVERLAY_LAYOUT,
      );
    }

    expect(store.order).toHaveLength(MAX_SAVED_ORIGINS);
    expect(store.layouts['https://site-0.example']).toBeUndefined();
    expect(store.layouts[`https://site-${MAX_SAVED_ORIGINS}.example`])
      .toBeDefined();

    const malformed = {
      layouts: Object.fromEntries(
        Array.from({ length: MAX_SAVED_ORIGINS + 10 }, (_, index) => [
          `https://old-${index}.example`,
          DEFAULT_OVERLAY_LAYOUT,
        ]),
      ),
      order: [],
      version: 1,
    };
    const repaired = saveLayoutForOrigin(
      malformed,
      'https://latest.example',
      DEFAULT_OVERLAY_LAYOUT,
    );
    expect(Object.keys(repaired.layouts)).toHaveLength(MAX_SAVED_ORIGINS);
    expect(repaired.layouts['https://latest.example']).toBeDefined();
  });

  it('extracts only valid HTTPS origins', () => {
    expect(httpsOrigin('https://example.com/watch?q=1')).toBe('https://example.com');
    expect(httpsOrigin('http://example.com')).toBeUndefined();
    expect(httpsOrigin('chrome://extensions')).toBeUndefined();
    expect(httpsOrigin('not a URL')).toBeUndefined();
  });
});
