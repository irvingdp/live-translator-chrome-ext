import { describe, expect, it } from 'vitest';

import type { CaptionUnitSpan } from '../../src/core/caption-chunker';
import {
  PUNCTUATION_TAIL_GRACE,
  splitIntoUnits,
  visualWidth,
} from '../../src/core/caption-chunker';

// Matches a UTF-16 surrogate that isn't part of a valid pair — evidence that
// an astral character was cut in half.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

// A unit is allowed to run up to PUNCTUATION_TAIL_GRACE columns over
// maxWidth: hardWrap folds a punctuation-only remainder (a stray comma, a
// closing bracket) into the unit before it rather than starting the next
// unit with it. See PUNCTUATION_TAIL_GRACE in the implementation.
function expectValidSplit(text: string, maxWidth: number): void {
  const units = splitIntoUnits(text, maxWidth);
  const strippedInput = text.replace(/\s+/gu, '');
  let strippedOutput = '';

  for (const unit of units) {
    expect(text.slice(unit.start, unit.end)).toBe(unit.text);
    expect(visualWidth(unit.text)).toBeLessThanOrEqual(maxWidth + PUNCTUATION_TAIL_GRACE);
    strippedOutput += unit.text.replace(/\s+/gu, '');
  }

  expect(strippedOutput).toBe(strippedInput);
}

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

describe('splitIntoUnits sentence-ending "." lookahead', () => {
  it('does not split a decimal number', () => {
    expect(splitIntoUnits('Numbers: 3.14 and 2.71 matter.', 40).map((unit) => unit.text))
      .toEqual(['Numbers: 3.14 and 2.71 matter.']);
  });

  it('does not split a dotted hostname', () => {
    expect(splitIntoUnits('Go to example.com now.', 40).map((unit) => unit.text))
      .toEqual(['Go to example.com now.']);
  });

  it('still splits an initialism followed by whitespace, as an accepted limitation', () => {
    expect(splitIntoUnits('U.S. policy changed.', 40).map((unit) => unit.text))
      .toEqual(['U.S.', 'policy changed.']);
  });

  it('still splits a CJK sentence ender with no following space', () => {
    expect(splitIntoUnits('大家好。今天天氣真好', 40).map((unit) => unit.text))
      .toEqual(['大家好。', '今天天氣真好']);
  });

  it('splits sentences at every CJK sentence-ending mark', () => {
    expect(splitIntoUnits('早安。今天天氣真好！你決定要出門嗎？', 40).map((unit) => unit.text))
      .toEqual(['早安。', '今天天氣真好！', '你決定要出門嗎？']);
  });
});

describe('splitIntoUnits astral-character safety', () => {
  it('never splits an astral character across two units', () => {
    const units = splitIntoUnits('ab𠀀cd', 3);

    expect(units.map((unit) => unit.text)).toEqual(['ab', '𠀀c', 'd']);
    expect(units.map((unit) => ({ end: unit.end, start: unit.start }))).toEqual([
      { end: 2, start: 0 },
      { end: 5, start: 2 },
      { end: 6, start: 5 },
    ]);
    for (const unit of units) {
      expect(LONE_SURROGATE.test(unit.text)).toBe(false);
    }
  });
});

describe('splitIntoUnits CJK width accounting', () => {
  it('hard wraps a run of CJK characters with no spaces at the width limit', () => {
    const text = '大家早安今天我們要討論的主題是關於人工智慧的未來發展方向';

    expect(splitIntoUnits(text, 20).map((unit) => unit.text)).toEqual([
      '大家早安今天我們要討',
      '論的主題是關於人工智',
      '慧的未來發展方向',
    ]);
  });

  it('splits an over-wide sentence at CJK clause punctuation', () => {
    const text = '今天天氣很好，適合出去走走，我們決定去公園散步。';

    expect(splitIntoUnits(text, 20).map((unit) => unit.text)).toEqual([
      '今天天氣很好，',
      '適合出去走走，',
      '我們決定去公園散步。',
    ]);
  });

  it('recognizes every CJK clause punctuation mark', () => {
    const text = '甲，乙、丙；丁：戊。';

    expect(splitIntoUnits(text, 4).map((unit) => unit.text)).toEqual([
      '甲，',
      '乙、',
      '丙；',
      '丁：',
      '戊。',
    ]);
  });
});

describe('splitIntoUnits unbreakable words', () => {
  it('hard wraps a long word with no punctuation or spaces', () => {
    expect(
      splitIntoUnits('supercalifragilisticexpialidocious', 10).map((unit) => unit.text),
    ).toEqual(['supercalif', 'ragilistic', 'expialidoc', 'ious']);
  });
});

describe('splitIntoUnits closing punctuation absorption', () => {
  it('keeps a trailing closing quote with the sentence it ends', () => {
    expect(
      splitIntoUnits('He said "hello." Then he left.', 40).map((unit) => unit.text),
    ).toEqual(['He said "hello."', 'Then he left.']);
  });

  it('keeps a trailing CJK closing bracket with the sentence it ends', () => {
    expect(splitIntoUnits('他說「你好。」然後他走了。', 40).map((unit) => unit.text)).toEqual([
      '他說「你好。」',
      '然後他走了。',
    ]);
  });

  it('recognizes a curly closing quote, not just a straight one', () => {
    expect(
      splitIntoUnits('He said “hello.” Then he left and went home.', 40).map(
        (unit) => unit.text,
      ),
    ).toEqual(['He said “hello.”', 'Then he left and went home.']);
  });

  it('recognizes a closing square bracket', () => {
    expect(splitIntoUnits('See [the note.] Then go.', 40).map((unit) => unit.text)).toEqual([
      'See [the note.]',
      'Then go.',
    ]);
  });
});

describe('hardWrap forced-progress guard', () => {
  it('still advances one character at a time when the limit is below any wide character', () => {
    expect(splitIntoUnits('大家好', 1).map((unit) => unit.text)).toEqual(['大', '家', '好']);
  });

  it('advances by a whole code point so a surrogate pair is never split', () => {
    const units = splitIntoUnits('𠀀', 1);

    expect(units).toHaveLength(1);
    expect(units[0]!.text).toBe('𠀀');
  });
});

describe('splitIntoUnits punctuation-only hardWrap remainder', () => {
  // At width 40 the clause is 42 columns wide. hardWrap's greedy cut lands
  // right before the trailing "，", which would otherwise become its own
  // 2-column remainder and get packed onto the front of the next clause.
  // Folding it into the unit before it costs 2 columns of overflow (well
  // within PUNCTUATION_TAIL_GRACE) but keeps every unit's leading character
  // real text instead of a stray clause mark.
  it('folds a stray trailing clause mark into the unit before it, not the start of the next unit', () => {
    const text =
      '今天我們要討論的主題是關於人工智慧的發展，還有它對整個社會的影響，以及我們應該如何面對未來。';
    const units = splitIntoUnits(text, 40);

    expect(units.map((unit) => unit.text)).toEqual([
      '今天我們要討論的主題是關於人工智慧的發展，',
      '還有它對整個社會的影響，',
      '以及我們應該如何面對未來。',
    ]);

    const leadingPunctuation = /^[.?!,;:。！？…，、；：]/u;
    for (const unit of units) {
      expect(leadingPunctuation.test(unit.text)).toBe(false);
    }
  });
});

describe('splitIntoUnits invariants', () => {
  it('keeps every unit slice-consistent with the source and inside the width limit plus grace', () => {
    expectValidSplit('Hello there. Next one.', 40);
    expectValidSplit(
      'And the people who were in this program, given a chance, learn skills.',
      30,
    );
    expectValidSplit('one two three four five six', 12);
    expectValidSplit('大家早安今天我們要討論的主題是關於人工智慧的未來發展方向', 20);
    expectValidSplit('supercalifragilisticexpialidocious', 10);
    expectValidSplit('Numbers: 3.14 and 2.71 matter.', 40);
    expectValidSplit('He said "hello." Then he left.', 40);
    expectValidSplit(
      '今天我們要討論的主題是關於人工智慧的發展，還有它對整個社會的影響，以及我們應該如何面對未來。',
      40,
    );
  });
});

describe('splitIntoUnits prefix stability', () => {
  // Verified only for the clamped production width range (40-140), not in
  // general. packSpans' merge decision for unit N depends on unit N+1's
  // final extent, and hardWrap's trailing word-break exemption lets N+1
  // shrink once a partial word completes and gets word-broken -- which can
  // retroactively make an earlier merge newly fit. That is a real,
  // pre-existing instability at narrow widths (e.g. 158 boundary changes
  // measured across widths 8-30 for the Latin sample below); it just never
  // surfaces at widths the settings can produce, and fixing it would mean
  // redesigning the packing stage, which is out of scope here.
  function assertPrefixStability(full: string, width: number): void {
    const closed: CaptionUnitSpan[] = [];
    let previousClosedCount = 0;

    for (let length = 1; length <= full.length; length += 1) {
      const units = splitIntoUnits(full.slice(0, length), width);
      const closedCount = Math.max(units.length - 1, 0);

      // A closed unit vanishing would be the worst possible failure here,
      // so the count of closed units must never decrease.
      expect(closedCount).toBeGreaterThanOrEqual(previousClosedCount);
      previousClosedCount = closedCount;

      for (let index = 0; index < closedCount; index += 1) {
        const observed = units[index]!;
        const known = closed[index];
        if (known) {
          expect(observed).toEqual(known);
        } else {
          closed[index] = observed;
        }
      }
    }
  }

  it('never rewrites a closed unit boundary at production widths', () => {
    const latin =
      'And the people who were in this program, given a chance, learn skills. ' +
      'Thanks so much everyone for joining us today, we really appreciate your time here.';
    const cjk =
      '今天我們要討論的主題是關於人工智慧的發展，還有它對整個社會的影響，以及我們應該如何面對未來。' +
      '希望大家可以從中得到一些啟發，並且在日常生活中實踐這些想法，讓世界變得更加美好。';

    for (const width of [40, 90]) {
      assertPrefixStability(latin, width);
      assertPrefixStability(cjk, width);
    }
  });
});
