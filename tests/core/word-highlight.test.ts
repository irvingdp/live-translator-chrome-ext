import { describe, expect, it } from 'vitest';

import { CaptionWindow } from '../../src/core/caption-window';
import { clockTime, currentWordIndex, wordState } from '../../src/core/word-highlight';

describe('word highlight helpers', () => {
  it("runs a playing clock on at its rate from when it was read, and holds a paused one", () => {
    const clock = { at: 1_000, paused: false, rate: 1.5, time: 60 };
    expect(clockTime(clock, 3_000)).toBe(63);
    expect(clockTime({ ...clock, paused: true }, 3_000)).toBe(60);
    // A clock read a moment in the future (clock skew) does not run backwards.
    expect(clockTime(clock, 500)).toBe(60);
  });

  it('marks words said, current and upcoming', () => {
    const words = [{ end: 1, start: 0, text: 'a' }, { end: 2, start: 1.2, text: 'b' }];
    const current = currentWordIndex(words, 1.5);
    expect(words.map((_, index) => wordState(index, current))).toEqual(['said', 'current']);
  });

  it('keeps a pair\'s words in the caption window history, as copies', () => {
    const window = new CaptionWindow(2);
    window.upsertOriginal('c1', 'Hi there.');
    const words = [{ end: 1, start: 0, text: 'Hi' }];
    window.upsertWords('c1', words);
    words[0]!.text = 'changed';
    const [pair] = window.pairs();
    expect(pair!.words).toEqual([{ end: 1, start: 0, text: 'Hi' }]);
    pair!.words![0]!.text = 'again';
    expect(window.pairs()[0]!.words![0]!.text).toBe('Hi');
  });
});
