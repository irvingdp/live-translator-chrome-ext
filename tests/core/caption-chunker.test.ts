import { describe, expect, it } from 'vitest';

import { splitIntoUnits, visualWidth } from '../../src/core/caption-chunker';

describe('visualWidth', () => {
  it('counts CJK characters as two columns and Latin as one', () => {
    expect(visualWidth('abc')).toBe(3);
    expect(visualWidth('大家早安')).toBe(8);
    expect(visualWidth('a大')).toBe(3);
  });
});

describe('splitIntoUnits', () => {
  it('keeps a short sentence whole and keeps its punctuation', () => {
    expect(splitIntoUnits('Hello there. Next one.', 40).map((unit) => unit.text))
      .toEqual(['Hello there.', 'Next one.']);
  });

  it('splits an over-wide sentence at clause punctuation', () => {
    const text = 'And the people who were in this program, given a chance, learn skills.';

    expect(splitIntoUnits(text, 30).map((unit) => unit.text)).toEqual([
      'And the people who were in',
      'this program, given a chance,',
      'learn skills.',
    ]);
  });

  it('hard wraps at the last word boundary when there is no punctuation', () => {
    expect(splitIntoUnits('one two three four five six', 12).map((unit) => unit.text))
      .toEqual(['one two', 'three four', 'five six']);
  });

  it('reports offsets into the source text', () => {
    const [first, second] = splitIntoUnits('Hello there. Next one.', 40);

    expect(first).toMatchObject({ start: 0, end: 12 });
    expect(second).toMatchObject({ start: 13, end: 22 });
  });
});
