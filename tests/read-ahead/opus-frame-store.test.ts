import { describe, expect, it } from 'vitest';

import { OpusFrameStore } from '../../src/read-ahead/opus-frame-store';

// 20 ms frames from `start` for `seconds`, each tagged with its own time.
function frames(start: number, seconds: number, tag = 0) {
  return Array.from({ length: Math.round(seconds / 0.02) }, (_, index) => ({
    data: Uint8Array.from([tag]),
    timestamp: +(start + index * 0.02).toFixed(3),
  }));
}

describe('OpusFrameStore', () => {
  it('returns the contiguous run from a time, up to a limit', () => {
    const store = new OpusFrameStore();
    store.add(frames(10, 5));
    const run = store.run(11, 12);
    expect(run[0]!.timestamp).toBe(11);
    expect(run.at(-1)!.timestamp).toBe(11.98);
  });

  it('stops at a gap, so a run never spans two separate stretches', () => {
    const store = new OpusFrameStore();
    store.add(frames(0, 2));
    store.add(frames(50, 2));
    expect(store.run(1, 100).at(-1)!.timestamp).toBe(1.98);
  });

  it('starts at the first frame within the lookahead when nothing covers the time', () => {
    const store = new OpusFrameStore();
    store.add(frames(196.4, 2));
    expect(store.run(195, 300)).toEqual([]);
    expect(store.run(195, 300, 6)[0]!.timestamp).toBe(196.4);
  });

  it('keeps frames sorted when stretches arrive out of order, replacing re-appended ones', () => {
    const store = new OpusFrameStore();
    store.add(frames(20, 1, 1));
    store.add(frames(10, 1, 1));
    store.add(frames(20, 1, 2));
    expect(store.size).toBe(100);
    expect(store.run(10, 11)[0]!.data[0]).toBe(1);
    expect(store.run(20, 21).every((frame) => frame.data[0] === 2)).toBe(true);
  });

  it('drops what the SourceBuffer no longer holds', () => {
    const store = new OpusFrameStore();
    store.add(frames(0, 10));
    store.add(frames(100, 10));
    store.retain([[4, 10], [100, 105]]);
    // Range edges get 50 ms of slack: buffered is rounded.
    expect(store.run(0, 200, 10)[0]!.timestamp).toBeCloseTo(4, 1);
    expect(store.run(100, 200).at(-1)!.timestamp).toBeCloseTo(105, 1);
    expect(store.run(106, 200, 1)).toEqual([]);
  });
});
