import { describe, expect, it } from 'vitest';

import { TranscriptStabilizer } from '../../src/core/transcript-stabilizer';

describe('TranscriptStabilizer', () => {
  it('waits for a second interim revision before translating text', () => {
    const stabilizer = new TranscriptStabilizer();

    expect(
      stabilizer.ingest({
        isFinal: false,
        revision: 1,
        segmentId: 'segment-1',
        text: 'Good morning',
      }),
    ).toEqual({ originalText: 'Good morning' });
  });

  it('emits the word-complete prefix shared by consecutive revisions', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest({
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Good morning',
    });

    expect(
      stabilizer.ingest({
        isFinal: false,
        revision: 2,
        segmentId: 'segment-1',
        text: 'Good morning everyone',
      }),
    ).toEqual({
      originalText: 'Good morning everyone',
      translation: {
        isFinal: false,
        revision: 2,
        segmentId: 'segment-1',
        text: 'Good morning',
      },
    });
  });

  it('does not emit an already translated stable prefix again', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest({
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Good morning',
    });
    stabilizer.ingest({
      isFinal: false,
      revision: 2,
      segmentId: 'segment-1',
      text: 'Good morning everyone',
    });

    expect(
      stabilizer.ingest({
        isFinal: false,
        revision: 3,
        segmentId: 'segment-1',
        text: 'Good morning everyone here',
      }),
    ).toEqual({
      originalText: 'Good morning everyone here',
      translation: {
        isFinal: false,
        revision: 3,
        segmentId: 'segment-1',
        text: 'everyone',
      },
    });
  });

  it('emits the untranslated tail when a segment becomes final', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest({
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'Good morning',
    });
    stabilizer.ingest({
      isFinal: false,
      revision: 2,
      segmentId: 'segment-1',
      text: 'Good morning everyone',
    });

    expect(
      stabilizer.ingest({
        isFinal: true,
        revision: 3,
        segmentId: 'segment-1',
        text: 'Good morning everyone.',
      }),
    ).toEqual({
      originalText: 'Good morning everyone.',
      translation: {
        isFinal: true,
        revision: 3,
        segmentId: 'segment-1',
        text: 'everyone.',
      },
    });
  });

  it('ignores revisions older than the last accepted revision', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest({
      isFinal: false,
      revision: 4,
      segmentId: 'segment-1',
      text: 'Current text',
    });

    expect(
      stabilizer.ingest({
        isFinal: false,
        revision: 3,
        segmentId: 'segment-1',
        text: 'Old text',
      }),
    ).toBeUndefined();
  });

  it('keeps independent state for simultaneous Deepgram segments', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest({
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'First segment',
    });

    expect(
      stabilizer.ingest({
        isFinal: false,
        revision: 1,
        segmentId: 'segment-2',
        text: 'Second segment',
      }),
    ).toEqual({ originalText: 'Second segment' });
  });

  it('ignores duplicate and older events after a segment is finalized', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest({
      isFinal: true,
      revision: 4,
      segmentId: 'segment-1',
      text: 'Finished sentence.',
    });

    expect(
      stabilizer.ingest({
        isFinal: true,
        revision: 4,
        segmentId: 'segment-1',
        text: 'Finished sentence.',
      }),
    ).toBeUndefined();
    expect(
      stabilizer.ingest({
        isFinal: false,
        revision: 3,
        segmentId: 'segment-1',
        text: 'Old sentence',
      }),
    ).toBeUndefined();
  });

  it('marks a corrected emitted prefix as a segment replacement', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest({
      isFinal: false,
      revision: 1,
      segmentId: 'segment-1',
      text: 'I like cats',
    });
    stabilizer.ingest({
      isFinal: false,
      revision: 2,
      segmentId: 'segment-1',
      text: 'I like cats today',
    });

    expect(
      stabilizer.ingest({
        isFinal: true,
        revision: 3,
        segmentId: 'segment-1',
        text: 'I love cats today.',
      }),
    ).toEqual({
      originalText: 'I love cats today.',
      translation: {
        isFinal: true,
        mode: 'replace',
        revision: 3,
        segmentId: 'segment-1',
        text: 'I love cats today.',
      },
    });
  });
});
