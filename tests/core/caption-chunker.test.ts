import { describe, expect, it } from 'vitest';

import type { CaptionUnitSpan } from '../../src/core/caption-chunker';
import {
  CaptionChunker,
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

describe('CaptionChunker', () => {
  const ingest = (
    chunker: CaptionChunker,
    stableText: string,
    rawText = stableText,
    isFinal = false,
  ) =>
    chunker.ingest({
      isFinal,
      maxWidth: 20,
      rawText,
      segmentId: 'segment-1',
      stableText,
    });

  it('shows the raw interim remainder as the open unit', () => {
    const chunker = new CaptionChunker();

    expect(ingest(chunker, 'Good morning', 'Good morning every')).toEqual([
      {
        displayText: 'Good morning every',
        id: 'segment-1#0',
        index: 0,
        isClosed: false,
        translateText: 'Good morning',
      },
    ]);
  });

  it('closes a unit once a later unit exists and keeps its text frozen', () => {
    const chunker = new CaptionChunker();
    ingest(chunker, 'Hello there.', 'Hello there. And');

    const units = ingest(chunker, 'Hello there. And now', 'Hello there. And now we');

    expect(units).toEqual([
      {
        displayText: 'Hello there.',
        id: 'segment-1#0',
        index: 0,
        isClosed: true,
        translateText: 'Hello there.',
      },
      {
        displayText: 'And now we',
        id: 'segment-1#1',
        index: 1,
        isClosed: false,
        translateText: 'And now',
      },
    ]);
  });

  it('keeps a frozen unit even when a later revision contradicts it', () => {
    const chunker = new CaptionChunker();
    ingest(chunker, 'Hello there. And now');

    const units = ingest(chunker, 'Hello THERE. And now then');

    expect(units.map((unit) => unit.id)).toEqual(['segment-1#1']);
    expect(units[0]).toMatchObject({ displayText: 'And now then' });
  });

  it('closes every unit when the segment is final', () => {
    const chunker = new CaptionChunker();
    // Only unit 0 exists so far, and it is still open: the whole raw text is
    // displayed as one unit because the stable text has no second unit yet.
    ingest(chunker, 'Hello there.', 'Hello there. And now');

    const units = ingest(chunker, 'Hello there. And now.', 'Hello there. And now.', true);

    // Both units close, and unit 0 is re-emitted so its display text shrinks
    // from the whole raw text to its own frozen sentence.
    expect(units.map((unit) => ({ id: unit.id, isClosed: unit.isClosed }))).toEqual([
      { id: 'segment-1#0', isClosed: true },
      { id: 'segment-1#1', isClosed: true },
    ]);
    expect(units[0]).toMatchObject({ displayText: 'Hello there.' });
    expect(units[1]).toMatchObject({ displayText: 'And now.' });
  });

  it('emits nothing when neither displayed nor translatable text changed', () => {
    const chunker = new CaptionChunker();
    ingest(chunker, 'Good morning');

    expect(ingest(chunker, 'Good morning')).toEqual([]);
  });

  it('keeps state isolated across interleaved segment ids', () => {
    const chunker = new CaptionChunker();

    const seg1First = chunker.ingest({
      isFinal: false,
      maxWidth: 20,
      rawText: 'Hello there. And',
      segmentId: 'segment-1',
      stableText: 'Hello there.',
    });
    const seg2First = chunker.ingest({
      isFinal: false,
      maxWidth: 20,
      rawText: 'Good morning every',
      segmentId: 'segment-2',
      stableText: 'Good morning',
    });
    const seg1Second = chunker.ingest({
      isFinal: false,
      maxWidth: 20,
      rawText: 'Hello there. And now we',
      segmentId: 'segment-1',
      stableText: 'Hello there. And now',
    });
    const seg2Repeat = chunker.ingest({
      isFinal: false,
      maxWidth: 20,
      rawText: 'Good morning every',
      segmentId: 'segment-2',
      stableText: 'Good morning',
    });

    expect(seg1First[0]).toMatchObject({ id: 'segment-1#0' });
    expect(seg2First[0]).toMatchObject({ id: 'segment-2#0' });
    expect(seg1Second.map((unit) => unit.id)).toEqual(['segment-1#0', 'segment-1#1']);
    // segment-2's open unit is untouched by segment-1's progress, so a
    // repeat of the same input still emits nothing.
    expect(seg2Repeat).toEqual([]);
  });

  it('starts clean when a segment id is reused after a final', () => {
    const chunker = new CaptionChunker();
    ingest(chunker, 'Hello there. And now.', 'Hello there. And now.', true);

    // Grown to two spans (a closed unit plus an open one) so this actually
    // discriminates: with only one span the reused segment never reaches a
    // second unit, so this would pass even if segments.delete were removed.
    const units = ingest(chunker, 'Hello there. And now', 'Hello there. And now we');

    expect(units).toEqual([
      {
        displayText: 'Hello there.',
        id: 'segment-1#0',
        index: 0,
        isClosed: true,
        translateText: 'Hello there.',
      },
      {
        displayText: 'And now we',
        id: 'segment-1#1',
        index: 1,
        isClosed: false,
        translateText: 'And now',
      },
    ]);
  });

  it('resets all segment state when clear is called', () => {
    const chunker = new CaptionChunker();
    ingest(chunker, 'Hello there.', 'Hello there. And');
    ingest(chunker, 'Hello there. And now', 'Hello there. And now we');

    chunker.clear();
    // Replaying the exact input that previously closed unit 0 and opened
    // unit 1: if clear() had not reset the segment, this would emit nothing
    // (the state would already match), so a non-empty result proves the
    // reset happened.
    const units = ingest(chunker, 'Hello there. And now', 'Hello there. And now we');

    expect(units).toEqual([
      {
        displayText: 'Hello there.',
        id: 'segment-1#0',
        index: 0,
        isClosed: true,
        translateText: 'Hello there.',
      },
      {
        displayText: 'And now we',
        id: 'segment-1#1',
        index: 1,
        isClosed: false,
        translateText: 'And now',
      },
    ]);
  });

  it('freezes and reopens units for a CJK segment', () => {
    const chunker = new CaptionChunker();
    chunker.ingest({
      isFinal: false,
      maxWidth: 20,
      rawText: '大家早安。今天',
      segmentId: 'segment-cjk',
      stableText: '大家早安。',
    });

    const units = chunker.ingest({
      isFinal: false,
      maxWidth: 20,
      rawText: '大家早安。今天我們要討論人工智慧的未來',
      segmentId: 'segment-cjk',
      stableText: '大家早安。今天我們要討論人工智慧',
    });

    expect(units).toEqual([
      {
        displayText: '大家早安。',
        id: 'segment-cjk#0',
        index: 0,
        isClosed: true,
        translateText: '大家早安。',
      },
      {
        displayText: '今天我們要討論人工智',
        id: 'segment-cjk#1',
        index: 1,
        isClosed: true,
        translateText: '今天我們要討論人工智',
      },
      {
        displayText: '慧的未來',
        id: 'segment-cjk#2',
        index: 2,
        isClosed: false,
        translateText: '慧',
      },
    ]);
  });

  it('falls back to the stable text when rawText is not a prefix of stableText', () => {
    const chunker = new CaptionChunker();
    ingest(chunker, 'Hello there. And now');

    const units = chunker.ingest({
      isFinal: false,
      maxWidth: 20,
      rawText: 'Something else entirely, not a continuation',
      segmentId: 'segment-1',
      stableText: 'Hello there. And now then',
    });

    // rawText no longer starts with stableText (a provider inconsistency).
    // displayText falls back to the stabilized text itself instead of
    // slicing the unrelated rawText at a meaningless offset: it degrades to
    // showing exactly what would be sent for translation. This is sticky,
    // not a one-update blip: if the mismatch persists across revisions (a
    // provider that always prepends a leading space, say), the segment
    // keeps losing its raw low-latency preview for as long as it does.
    expect(units).toEqual([
      {
        displayText: 'And now then',
        id: 'segment-1#1',
        index: 1,
        isClosed: false,
        translateText: 'And now then',
      },
    ]);
  });

  it('handles an empty stableText before anything has stabilized', () => {
    const chunker = new CaptionChunker();

    const units = chunker.ingest({
      isFinal: false,
      maxWidth: 20,
      rawText: 'Good',
      segmentId: 'segment-1',
      stableText: '',
    });

    // Nothing has stabilized yet, so there is nothing safe to translate:
    // displayText shows the raw text immediately, translateText is empty.
    expect(units).toEqual([
      {
        displayText: 'Good',
        id: 'segment-1#0',
        index: 0,
        isClosed: false,
        translateText: '',
      },
    ]);
  });

  it('keeps frozen units frozen and still delivers the final text across a live width change', () => {
    const chunker = new CaptionChunker();
    const text = 'the quick brown fox jumps over the lazy dog near the river';

    // At width 20 this hard-wraps into three units: two close immediately.
    const narrow = chunker.ingest({
      isFinal: false,
      maxWidth: 20,
      rawText: text,
      segmentId: 'segment-1',
      stableText: text,
    });

    expect(narrow).toEqual([
      {
        displayText: 'the quick brown fox',
        id: 'segment-1#0',
        index: 0,
        isClosed: true,
        translateText: 'the quick brown fox',
      },
      {
        displayText: 'jumps over the lazy',
        id: 'segment-1#1',
        index: 1,
        isClosed: true,
        translateText: 'jumps over the lazy',
      },
      {
        displayText: 'dog near the river',
        id: 'segment-1#2',
        index: 2,
        isClosed: false,
        translateText: 'dog near the river',
      },
    ]);

    // The user widens the caption window mid-segment. At width 90 the whole
    // text now fits as a single unit -- fewer units than are already
    // frozen. The already-closed segment-1#0 and segment-1#1 must not
    // reopen or renumber: the open unit stays segment-1#2, never colliding
    // with segment-1#0's id. Nothing new has stabilized at the new width
    // (there is no span at index 2 yet), so translateText regresses to
    // empty rather than reusing stale text.
    const widened = chunker.ingest({
      isFinal: false,
      maxWidth: 90,
      rawText: text,
      segmentId: 'segment-1',
      stableText: text,
    });

    expect(widened).toEqual([
      {
        displayText: 'dog near the river',
        id: 'segment-1#2',
        index: 2,
        isClosed: false,
        translateText: '',
      },
    ]);

    // The segment ends at the new width. The final text must still reach
    // the window even though the recomputed span list (one span covering
    // the whole text) never reaches index 2: the remainder beyond the last
    // frozen boundary is emitted as one closing unit instead of being
    // silently dropped.
    const final = chunker.ingest({
      isFinal: true,
      maxWidth: 90,
      rawText: text,
      segmentId: 'segment-1',
      stableText: text,
    });

    expect(final).toEqual([
      {
        displayText: 'dog near the river',
        id: 'segment-1#2',
        index: 2,
        isClosed: true,
        translateText: 'dog near the river',
      },
    ]);
  });

  it('still delivers the remaining text when a final revises to fewer units than were already frozen', () => {
    const chunker = new CaptionChunker();
    // Two sentences close, a third opens.
    ingest(chunker, 'Hi. Bye now. Ok then', 'Hi. Bye now. Ok then');

    // The final merges the first two sentences into one (no more mid-period)
    // and shortens the tail -- the final text is shorter than the interim
    // that preceded it, and it re-splits into only two spans, fewer than
    // the two units already frozen. The already-closed 'Hi.' and 'Bye now.'
    // must stay exactly as frozen (never rewritten to 'Hi bye now.'), and
    // the new tail content must still reach the window rather than vanish.
    const units = ingest(chunker, 'Hi bye now. Ok.', 'Hi bye now. Ok.', true);

    expect(units).toEqual([
      {
        displayText: 'Ok.',
        id: 'segment-1#2',
        index: 2,
        isClosed: true,
        translateText: 'Ok.',
      },
    ]);
  });

  it('does not swallow an open unit whose text matches what the previous open unit last showed', () => {
    const chunker = new CaptionChunker();
    // segment-1#0 opens, showing 'ha ha. ha ha' / translating 'ha ha.'.
    ingest(chunker, 'ha ha.', 'ha ha. ha ha');

    // segment-1#0 closes on 'ha ha.', and segment-1#1 opens -- but its
    // display/translate text happens to equal what segment-1#0 last showed
    // while open. A comparison keyed only on text, not on which unit is
    // open, would wrongly treat #1 as unchanged and never emit it.
    const units = ingest(chunker, 'ha ha. ha ha.', 'ha ha. ha ha. ha ha');

    expect(units).toEqual([
      {
        displayText: 'ha ha.',
        id: 'segment-1#0',
        index: 0,
        isClosed: true,
        translateText: 'ha ha.',
      },
      {
        displayText: 'ha ha. ha ha',
        id: 'segment-1#1',
        index: 1,
        isClosed: false,
        translateText: 'ha ha.',
      },
    ]);
  });

  // A revision can change the *length* of text at or before a frozen
  // boundary -- a provider revising an early word once more context arrives,
  // not just appending after it. A numeric offset recorded at freeze time
  // then no longer lines up with a word boundary in the new text, so the
  // open unit is anchored by the frozen text itself and only falls back to
  // the offset when that text cannot be found at all. translateText is never
  // affected either way: it always comes from a fresh splitIntoUnits span.
  describe('boundary shifts at maxWidth 90', () => {
    const ingest90 = (chunker: CaptionChunker, stableText: string) =>
      chunker.ingest({
        isFinal: false,
        maxWidth: 90,
        rawText: stableText,
        segmentId: 'segment-1',
        stableText,
      });

    it('relocates the open unit when a revision shifts the frozen text along', () => {
      const chunker = new CaptionChunker();
      ingest90(chunker, 'Yes. Right now then');

      // The revision prepends "Um, " before the frozen "Yes.", so the offset
      // recorded at freeze time now points into the middle of the new text.
      // Finding the frozen text itself keeps the open unit starting after it
      // rather than repeating it -- so the open unit reads exactly as before
      // and there is nothing to emit.
      expect(ingest90(chunker, 'Um, Yes. Right now then')).toEqual([]);

      // Growing the shifted text proves the anchor really did relocate: a
      // stale offset would prepend "Yes. " here, and a lost anchor would
      // prepend "Um, Yes. " as well.
      const units = ingest90(chunker, 'Um, Yes. Right now then and more');

      expect(units).toEqual([
        {
          displayText: 'Right now then and more',
          id: 'segment-1#1',
          index: 1,
          isClosed: false,
          translateText: 'Right now then and more',
        },
      ]);
    });

    it('shows whole text rather than a mid-word cut when the frozen text is gone', () => {
      const chunker = new CaptionChunker();
      ingest90(chunker, 'Yes. Right now then');

      // Here the revision rewrites the frozen text itself ("Yes." becomes
      // "yes."), so there is nothing left to anchor on. Repeating a few words
      // is readable; slicing at the stale offset would chop a word in half
      // and put "es. Right now then" on screen.
      const units = ingest90(chunker, 'Oh yes. Right now then');

      expect(units).toEqual([
        {
          displayText: 'Oh yes. Right now then',
          id: 'segment-1#1',
          index: 1,
          isClosed: false,
          translateText: 'Right now then',
        },
      ]);
    });
  });
});
