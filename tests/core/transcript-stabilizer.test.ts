import { describe, expect, it } from 'vitest';

import { TranscriptStabilizer } from '../../src/core/transcript-stabilizer';

describe('TranscriptStabilizer', () => {
  const event = (text: string, revision: number, isFinal = false) => ({
    isFinal,
    revision,
    segmentId: 'segment-1',
    text,
  });

  it('has no stable text until two revisions agree', () => {
    const stabilizer = new TranscriptStabilizer();

    expect(stabilizer.ingest(event('Good morning', 1))).toEqual({
      originalText: 'Good morning',
      stableText: '',
    });
  });

  it('stabilizes the word-complete prefix shared by consecutive revisions', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest(event('Good morning', 1));

    expect(stabilizer.ingest(event('Good morning everyone', 2))).toEqual({
      originalText: 'Good morning everyone',
      stableText: 'Good morning',
    });
  });

  it('never shrinks stable text when a revision retracts words', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest(event('Good morning', 1));
    stabilizer.ingest(event('Good morning everyone', 2));

    expect(stabilizer.ingest(event('Good mo', 3))).toMatchObject({
      stableText: 'Good morning',
    });
  });

  it('takes the final text verbatim even when it is shorter', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest(event('Good morning', 1));
    stabilizer.ingest(event('Good morning everyone', 2));

    expect(stabilizer.ingest(event('Good morning all.', 3, true))).toEqual({
      originalText: 'Good morning all.',
      stableText: 'Good morning all.',
    });
  });

  it('drops events that repeat or precede a revision already seen', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest(event('Good morning', 2));

    expect(stabilizer.ingest(event('Good', 1))).toBeUndefined();
  });

  it('drops events that arrive after the segment was finalized', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest(event('Good morning.', 5, true));

    expect(stabilizer.ingest(event('Good morning', 4))).toBeUndefined();
  });

  it('keeps independent stable text and revision state for interleaved segments', () => {
    const stabilizer = new TranscriptStabilizer();
    const eventFor = (segmentId: string, text: string, revision: number) => ({
      isFinal: false,
      revision,
      segmentId,
      text,
    });

    stabilizer.ingest(eventFor('segment-a', 'Hello', 1));
    stabilizer.ingest(eventFor('segment-b', 'Bonjour', 1));

    expect(
      stabilizer.ingest(eventFor('segment-a', 'Hello there', 2)),
    ).toEqual({ originalText: 'Hello there', stableText: 'Hello' });

    // segment-b advancing must not be affected by segment-a's state, and vice
    // versa: each segment's revision counter and stable text are independent.
    expect(
      stabilizer.ingest(eventFor('segment-b', 'Bonjour tout', 2)),
    ).toEqual({ originalText: 'Bonjour tout', stableText: 'Bonjour' });

    // A stale revision for segment-b must not be rejected because of
    // segment-a's revision count (they would collide if state were shared).
    expect(stabilizer.ingest(eventFor('segment-a', 'Hel', 1))).toBeUndefined();
  });

  it('only ever grows stable text across a run that retracts then extends again', () => {
    const stabilizer = new TranscriptStabilizer();
    const seen: string[] = [];
    const revisions = [
      'One',
      'One two',
      'One tw', // retracts a word
      'One two three', // re-extends past the retraction
      'One two three four', // agrees with the prior (non-fragment) revision, so it can stabilize further
    ];

    revisions.forEach((text, index) => {
      const update = stabilizer.ingest(event(text, index + 1));
      seen.push(update!.stableText);
    });

    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]!.length).toBeGreaterThanOrEqual(seen[i - 1]!.length);
    }
    // The retraction (revision 3) does not un-stabilize 'One'; growth only
    // resumes once a later revision agrees with a full, non-fragment
    // predecessor again (revision 5 agreeing with revision 4's raw text).
    expect(seen).toEqual(['', 'One', 'One', 'One', 'One two three']);
  });

  it('stabilizes CJK text with no spaces by taking the whole common prefix', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest(event('你好', 1));

    // With no whitespace anywhere in the common prefix, stableBoundary's
    // whitespace-trim branch never triggers, so the entire shared prefix
    // (not a word-complete subset of it) becomes stable text immediately.
    expect(stabilizer.ingest(event('你好世界', 2))).toEqual({
      originalText: '你好世界',
      stableText: '你好',
    });
  });

  it('accepts a same-length correction rather than keeping stale text', () => {
    const stabilizer = new TranscriptStabilizer();
    // 'Ready set go' is 12 characters and becomes the stored stable text.
    stabilizer.ingest(event('Ready set go', 1));
    stabilizer.ingest(event('Ready set go now', 2));

    // A later revision can rewrite lastText to something unrelated (Deepgram
    // can revise a segment's wording outright, not just extend it). This
    // revision's own candidate is discarded (no shared prefix with the old
    // lastText), but lastText itself is unconditionally overwritten.
    stabilizer.ingest(event('Sunny day hi', 3));

    // The next revision extends *that* new text by one word-complete unit.
    // 'Sunny day hi' is also 12 characters, so its candidate ties the stored
    // stable text's length exactly.
    const update = stabilizer.ingest(event('Sunny day hi there', 4));

    // The candidate ties the stored length exactly. Comparing with `>` would
    // keep the stale text forever; same-length corrections are ordinary in
    // speech recognition ("their" for "there"), and taking the newer text
    // still cannot shrink what was already stable.
    expect(update).toEqual({
      originalText: 'Sunny day hi there',
      stableText: 'Sunny day hi',
    });
  });
});
