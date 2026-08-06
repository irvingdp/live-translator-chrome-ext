import { describe, expect, it } from 'vitest';

import { CaptionWindow } from '../../src/core/caption-window';

describe('CaptionWindow', () => {
  it('keeps only the last two units in arrival order', () => {
    const window = new CaptionWindow();
    window.upsertOriginal('a', 'first');
    window.upsertOriginal('b', 'second');
    window.upsertOriginal('c', 'third');

    expect(window.pairs()).toEqual([
      { id: 'b', original: 'second', translation: '' },
      { id: 'c', original: 'third', translation: '' },
    ]);
  });

  it('updates an existing unit without changing its position', () => {
    const window = new CaptionWindow();
    window.upsertOriginal('a', 'first');
    window.upsertOriginal('b', 'second');
    window.upsertOriginal('a', 'first revised');

    expect(window.pairs().map((pair) => pair.id)).toEqual(['a', 'b']);
    expect(window.pairs()[0]).toMatchObject({ original: 'first revised' });
  });

  it('ignores a translation for a unit that has already been dropped', () => {
    const window = new CaptionWindow();
    window.upsertOriginal('a', 'first');
    window.upsertOriginal('b', 'second');
    window.upsertOriginal('c', 'third');
    window.upsertTranslation('a', '第一');

    expect(window.pairs().every((pair) => pair.translation === '')).toBe(true);
  });

  it('holds the number of units it was built for', () => {
    const window = new CaptionWindow(3);
    for (const id of ['a', 'b', 'c', 'd']) window.upsertOriginal(id, id);

    expect(window.pairs().map((pair) => pair.id)).toEqual(['b', 'c', 'd']);
  });

  it('shows a single unit when asked for one row', () => {
    const window = new CaptionWindow(1);
    window.upsertOriginal('a', 'first');
    window.upsertOriginal('b', 'second');

    expect(window.pairs().map((pair) => pair.id)).toEqual(['b']);
  });

  it('drops the oldest units when the capacity shrinks mid-session', () => {
    const window = new CaptionWindow(3);
    for (const id of ['a', 'b', 'c']) window.upsertOriginal(id, id);

    window.setCapacity(1);

    expect(window.pairs().map((pair) => pair.id)).toEqual(['c']);
  });

  it('keeps what it has when the capacity grows mid-session', () => {
    const window = new CaptionWindow(2);
    window.upsertOriginal('a', 'first');
    window.upsertOriginal('b', 'second');

    window.setCapacity(3);
    window.upsertOriginal('c', 'third');

    expect(window.pairs().map((pair) => pair.id)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to one row rather than going unbounded on a bad capacity', () => {
    const window = new CaptionWindow(2);
    window.setCapacity(Number.NaN);
    for (const id of ['a', 'b', 'c']) window.upsertOriginal(id, id);

    expect(window.pairs().map((pair) => pair.id)).toEqual(['c']);
  });

  it('clears every unit', () => {
    const window = new CaptionWindow();
    window.upsertOriginal('a', 'first');
    window.clear();

    expect(window.pairs()).toEqual([]);
  });

  it('returns copies, not live references, so a sent payload cannot mutate afterward', () => {
    const window = new CaptionWindow();
    window.upsertOriginal('a', 'first');
    const captured = window.pairs();

    window.upsertOriginal('a', 'first revised');
    window.upsertTranslation('a', '第一');
    window.upsertOriginal('b', 'second');

    expect(captured).toEqual([{ id: 'a', original: 'first', translation: '' }]);
  });

  it('keeps a translation on an existing unit when its original is later updated', () => {
    const window = new CaptionWindow();
    window.upsertOriginal('a', 'first');
    window.upsertTranslation('a', '第一');
    window.upsertOriginal('a', 'first revised');

    expect(window.pairs()).toEqual([
      { id: 'a', original: 'first revised', translation: '第一' },
    ]);
  });

  it('treats a re-added id that was previously dropped as a new arrival at the end', () => {
    const window = new CaptionWindow();
    window.upsertOriginal('a', 'first');
    window.upsertOriginal('b', 'second');
    window.upsertOriginal('c', 'third');
    // 'a' was dropped by the push above; re-adding it is a fresh arrival.
    window.upsertOriginal('a', 'first again');

    expect(window.pairs()).toEqual([
      { id: 'c', original: 'third', translation: '' },
      { id: 'a', original: 'first again', translation: '' },
    ]);
  });
});
