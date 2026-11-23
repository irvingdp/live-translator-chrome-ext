import { describe, expect, it, vi } from 'vitest';

import type { ChunkSentence } from '../../src/read-ahead/gemini-chunk-translation';
import { ChunkTranslationError } from '../../src/read-ahead/gemini-chunk-translation';
import {
  decideCut,
  readAheadFailure,
  ReadAheadSession,
  SAMPLE_RATE,
  type DisplayedCue,
  type MainPlayer,
  type ReadAheadStatus,
} from '../../src/read-ahead/read-ahead-session';

// Audio is described as alternating [speech seconds, silence seconds, ...].
function audio(pattern: number[]): Float32Array {
  const total = pattern.reduce((sum, seconds) => sum + seconds, 0);
  const samples = new Float32Array(Math.round(total * SAMPLE_RATE));
  let offset = 0;
  pattern.forEach((seconds, index) => {
    const length = Math.round(seconds * SAMPLE_RATE);
    if (index % 2 === 0) {
      // Each burst opens with 30 ms of quiet, as speech does after a breath,
      // so only a cut through the middle of a burst looks like a fragment.
      for (let i = Math.round(0.03 * SAMPLE_RATE); i < length; i += 1) samples[offset + i] = 0.3 * Math.sin(i / 3);
    }
    offset += length;
  });
  return samples;
}

// What a well-behaved model returns: one sentence per burst of speech, timed
// relative to the chunk, flagged `cut` when the burst touches a chunk edge.
function sentencesFor(pcm: Int16Array): ChunkSentence[] {
  const frame = SAMPLE_RATE / 100;
  const sentences: ChunkSentence[] = [];
  let start = -1;
  const frames = Math.floor(pcm.length / frame);
  for (let f = 0; f <= frames; f += 1) {
    let loud = false;
    if (f < frames) {
      for (let i = 0; i < frame; i += 1) if (Math.abs(pcm[f * frame + i]!) > 1000) loud = true;
    }
    if (loud && start < 0) start = f;
    if (!loud && start >= 0) {
      sentences.push({
        cut: start === 0 || f >= frames,
        end: f / 100,
        original: `sentence ${(start / 100).toFixed(2)}`,
        sameLanguage: false,
        start: start / 100,
        translation: `譯 ${(start / 100).toFixed(2)}`,
      });
      start = -1;
    }
  }
  return sentences;
}

class FakeMain implements MainPlayer {
  time = 0;
  isPaused = false;
  ad = false;
  rate = 1;
  length = 600;
  events: Array<'pause' | 'play'> = [];
  adPlaying() { return this.ad; }
  currentTime() { return this.time; }
  duration() { return this.length; }
  paused() { return this.isPaused; }
  playbackRate() { return this.rate; }
  pause() { this.isPaused = true; this.events.push('pause'); }
  play() { this.isPaused = false; this.events.push('play'); }
}

interface Pending {
  pcm: Int16Array;
  reject(error: unknown): void;
  resolve(sentences: ChunkSentence[]): void;
}

function setup(options: { autoTranslate?: boolean; start?: number } = {}) {
  const main = new FakeMain();
  main.time = options.start ?? 0;
  const pending: Pending[] = [];
  const cues: Array<DisplayedCue | undefined> = [];
  const statuses: ReadAheadStatus[] = [];
  const source = { refill: vi.fn(), seek: vi.fn(), setRunning: vi.fn() };
  const clock = { now: 0 };
  const translate = vi.fn((pcm: Int16Array) => options.autoTranslate
    ? Promise.resolve(sentencesFor(pcm))
    : new Promise<ChunkSentence[]>((resolve, reject) => pending.push({ pcm, reject, resolve })));
  const session = new ReadAheadSession({
    main,
    now: () => clock.now,
    showCue: (cue) => cues.push(cue),
    showStatus: (status) => statuses.push(status),
    source,
    translate,
  });
  // Media elements report pause/play asynchronously; deliver them like that.
  const deliver = () => {
    for (const event of main.events.splice(0)) {
      if (event === 'pause') session.onMainPause(); else session.onMainPlay();
    }
  };
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
      deliver();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    deliver();
  };
  const at = (time: number) => {
    main.time = time;
    session.tick();
    deliver();
  };
  const chunkSeconds = () => translate.mock.calls.map(([pcm]) => +(pcm.length / SAMPLE_RATE).toFixed(2));
  const lastCue = () => cues.at(-1);
  return { at, chunkSeconds, clock, cues, deliver, lastCue, main, pending, session, settle, source, statuses, translate };
}

describe('ReadAheadSession', () => {
  it('holds at the start, sends speech up to a pause past 5 s ahead of the viewer, then resumes in sync', async () => {
    const t = setup();
    t.at(0);
    expect(t.main.isPaused).toBe(true);
    expect(t.statuses.at(-1)).toBe('loading');
    expect(t.source.seek).toHaveBeenCalledWith(0);

    t.session.acceptAudio({ samples: audio([3, 0.5, 4, 0.5]), start: 0 });
    expect(t.chunkSeconds()[0]).toBeCloseTo(7.75, 1);
    // The audio is here; the hold now waits on the translation.
    expect(t.statuses.at(-1)).toBe('translating');

    t.pending[0]!.resolve(sentencesFor(t.pending[0]!.pcm));
    await t.settle();
    expect(t.main.isPaused).toBe(false);
    expect(t.statuses.at(-1)).toBeUndefined();
    t.at(0.5);
    expect(t.lastCue()).toMatchObject({ original: 'sentence 0.03', translation: '譯 0.03' });
  });

  it('shows a cue from its start until 1 s after its end, or until the next cue starts', async () => {
    const t = setup({ autoTranslate: true });
    // A short video, so the second chunk can take the rest without waiting
    // for 15 s of audio.
    t.main.length = 9.3;
    t.session.acceptAudio({ samples: audio([2.5, 0.4, 0.5, 0.4, 2.5, 3]), start: 0 });
    await t.settle();
    // Sentences: 0.03–2.5, 2.93–3.4, 3.83–6.3 (labels are chunk-relative).
    t.at(2.6);
    const first = t.lastCue()?.id;
    expect(first).toBeDefined();
    t.at(2.95);
    const second = t.lastCue()?.id;
    expect(second).not.toBe(first);
    t.at(3.5);
    expect(t.lastCue()?.id).toBe(second);
    t.at(3.85);
    const third = t.lastCue()?.id;
    expect(third).not.toBe(second);
    t.at(7.2);
    expect(t.lastCue()?.id).toBe(third);
    t.at(7.4);
    expect(t.lastCue()).toBeUndefined();
  });

  it('hard-cuts speech with no pause at 15 s and overlaps 2 s without duplicating the cut sentence', async () => {
    const t = setup({ autoTranslate: true, start: 0 });
    t.session.acceptAudio({ samples: audio([2.5, 0.5, 30, 1]), start: 0 });
    await t.settle();
    const [first, second] = t.chunkSeconds();
    // No pause past 5 s within the first 15 s: hard cut, then a 2 s overlap.
    expect(first).toBe(15);
    expect(second).toBe(15);
    const shown = new Set(t.cues.flatMap((cue) => cue ? [cue.original] : []));
    t.at(3); t.at(14); t.at(20); t.at(32);
    const reached = t.cues.flatMap((cue) => cue ? [cue.original] : []);
    expect(new Set(reached).size).toBe(new Set([...shown, ...reached]).size);
    expect(reached.filter((text) => text === reached.at(-1))).toHaveLength(1);
  });

  it('does not hold after a seek into translated media, and re-reads from 5 s before an untranslated target', async () => {
    const t = setup({ autoTranslate: true });
    t.main.length = 7;
    t.session.acceptAudio({ samples: audio([3, 0.5, 3, 0.5]), start: 0 });
    await t.settle();
    t.at(1);
    t.main.time = 4;
    t.session.onMainSeeking();
    t.deliver();
    expect(t.main.isPaused).toBe(false);

    t.main.length = 600;
    t.main.time = 100;
    t.session.onMainSeeking();
    t.deliver();
    expect(t.source.seek).toHaveBeenLastCalledWith(95);
    expect(t.main.isPaused).toBe(true);
    expect(t.statuses.at(-1)).toBe('loading');
  });

  it('starts at the first audio it has when the source cannot reach back before a seek', async () => {
    const t = setup();
    t.main.time = 200;
    t.session.onMainSeeking();
    t.session.acceptAudio({ samples: audio([2.5, 0.5, 2, 0.5]), start: 199.5 });
    expect(t.translate).toHaveBeenCalled();
    // The fragment at the chunk start is dropped: the edge cut through speech.
    t.pending[0]!.resolve([
      { cut: true, end: 2.5, original: 'half', sameLanguage: false, start: 0, translation: '半' },
      { cut: false, end: 5, original: 'whole', sameLanguage: false, start: 3, translation: '全' },
    ]);
    await t.settle();
    t.at(202.6);
    expect(t.cues.flatMap((cue) => cue ? [cue.original] : [])).toEqual(['whole']);
  });

  it('keeps a long sentence a hard cut went through, and its tail from the next chunk', async () => {
    // Fast talk with no pause: both chunks are cut hard at 15 s, overlapping 2 s.
    const t = setup();
    t.at(0);
    t.session.acceptAudio({ samples: audio([40]), start: 0 });
    expect(t.chunkSeconds()).toEqual([15, 15]);
    const sentence = (start: number, end: number, original: string, cut = false): ChunkSentence =>
      ({ cut, end, original, sameLanguage: false, start, translation: `譯${original}` });
    // Chunk 1 (0–15 s): its last sentence started at 5 s, long before the
    // overlap, and runs past the cut.
    t.pending[0]!.resolve([sentence(0.5, 4, 'One.'), sentence(5, 15, 'so how can you cycle back', true)]);
    // Chunk 2 (13–28 s): it sees only that sentence's tail, then more.
    t.pending[1]!.resolve([sentence(0, 3, 'into the planning stage.', true), sentence(4, 8, 'Three.'), sentence(9, 15, 'and then', true)]);
    await t.settle();
    const shown = (time: number) => { t.at(time); return t.lastCue()?.original; };
    expect(shown(6)).toBe('so how can you cycle back');
    expect(shown(13.5)).toBe('into the planning stage.');
    expect(shown(17.5)).toBe('Three.');
  });

  it('still drops a sentence a hard cut went through when it starts inside the overlap', async () => {
    const t = setup();
    t.at(0);
    t.session.acceptAudio({ samples: audio([40]), start: 0 });
    const sentence = (start: number, end: number, original: string, cut = false): ChunkSentence =>
      ({ cut, end, original, sameLanguage: false, start, translation: '' });
    t.pending[0]!.resolve([sentence(0.5, 12, 'One.'), sentence(13.5, 15, 'half of', true)]);
    // The next chunk, starting at 13 s, has that sentence whole.
    t.pending[1]!.resolve([sentence(0.5, 3, 'half of it, whole.'), sentence(4, 15, 'more', true)]);
    await t.settle();
    t.at(14);
    expect(t.lastCue()?.original).toBe('half of it, whole.');
  });

  it('does not resume after the hold when the viewer paused during it', async () => {
    const t = setup();
    t.at(0);
    t.main.isPaused = true;
    t.session.onMainPause();
    t.session.acceptAudio({ samples: audio([3, 0.5, 1]), start: 0 });
    t.pending[0]!.resolve(sentencesFor(t.pending[0]!.pcm));
    await t.settle();
    expect(t.main.isPaused).toBe(true);
    expect(t.statuses.at(-1)).toBeUndefined();
  });

  it('keeps holding when the viewer presses play during a hold, then resumes', async () => {
    const t = setup();
    t.at(0);
    t.main.isPaused = false;
    t.session.onMainPlay();
    t.deliver();
    expect(t.main.isPaused).toBe(true);
    t.session.acceptAudio({ samples: audio([3, 0.5, 1]), start: 0 });
    t.pending[0]!.resolve(sentencesFor(t.pending[0]!.pcm));
    await t.settle();
    expect(t.main.isPaused).toBe(false);
  });

  it('says it is waiting for audio, not a translation, when the chunks end just past the viewer', async () => {
    const t = setup({ autoTranslate: true });
    t.session.acceptAudio({ samples: audio([3, 0.5, 1, 0.5]), start: 0 });
    await t.settle();
    // The first chunk is cut at the pause, 3.25 s; the rest of the audio is
    // too short to make the next one. The translated stretch ends 0.1 s ahead.
    t.at(3.15);
    expect(t.main.isPaused).toBe(true);
    expect(t.statuses.at(-1)).toBe('loading');
  });

  it('plays through a hole of a few hundredths of a second between chunks', async () => {
    // A MediaSource player's audio can have tiny holes the player plays
    // straight through (Bilibili: 99.30 → 99.33, a little over 0.03 s). They are not worth a hold,
    // and a refill cannot fill them.
    const t = setup({ autoTranslate: true });
    t.session.acceptAudio({ samples: audio([4, 0.5, 4, 0.5, 1]), start: 0 });
    t.session.acceptAudio({ samples: audio([4, 0.5, 4, 1.5]), start: 10.05 });
    await t.settle();
    t.at(9.9);
    await t.settle();
    t.at(9.9);
    expect(t.main.isPaused).toBe(false);
    expect(t.statuses.at(-1)).not.toBe('loading');
  });

  it('gives a cue its words at media time, for word highlight', async () => {
    const t = setup();
    t.main.time = 200;
    t.session.onMainSeeking();
    t.session.acceptAudio({ samples: audio([2.5, 0.5, 2, 0.5]), start: 199.5 });
    t.pending[0]!.resolve([{
      cut: false, end: 2.5, original: 'Hello there.', sameLanguage: false, start: 0.5, translation: '你好。',
      words: [{ end: 1, start: 0.5, text: 'Hello' }, { end: 2.5, start: 1.25, text: 'there.' }],
    }]);
    await t.settle();
    t.at(200.2);
    expect(t.lastCue()).toMatchObject({
      original: 'Hello there.',
      words: [{ end: 200.5, start: 200, text: 'Hello' }, { end: 202, start: 200.75, text: 'there.' }],
    });
  });

  it('neither holds nor shows captions while the main player shows an ad', () => {
    const t = setup();
    t.main.ad = true;
    t.at(0);
    expect(t.main.isPaused).toBe(false);
    expect(t.source.setRunning).toHaveBeenLastCalledWith(false, 1);
  });

  it('does not retry: one failed request marks the chunk 翻譯失敗 and plays on', async () => {
    const t = setup();
    t.translate.mockRejectedValue(new ChunkTranslationError('provider_unavailable', 503));
    t.session.acceptAudio({ samples: audio([3, 0.5, 1]), start: 0 });
    t.at(0);
    await t.settle();
    expect(t.translate).toHaveBeenCalledTimes(1);
    expect(t.main.isPaused).toBe(false);
    t.at(1);
    expect(t.statuses.at(-1)).toBe('failed');
  });

  it('reads a failed chunk again when the viewer seeks back into it, and only then', async () => {
    const t = setup();
    t.translate.mockRejectedValueOnce(new Error('groq_timeout'));
    t.session.acceptAudio({ samples: audio([3, 0.5, 1]), start: 0 });
    t.at(0);
    await t.settle();
    t.at(1);
    expect(t.statuses.at(-1)).toBe('groq_timeout');
    t.at(2);
    t.session.tick();
    expect(t.translate).toHaveBeenCalledTimes(1);

    // Back to the start: the failed stretch is asked for again.
    t.main.time = 0.5;
    t.session.onMainSeeking();
    t.session.acceptAudio({ samples: audio([3, 0.5, 1]), start: 0 });
    t.session.tick();
    expect(t.translate).toHaveBeenCalledTimes(2);
    const retry = t.pending.shift()!;
    retry.resolve(sentencesFor(retry.pcm));
    await t.settle();
    t.at(1);
    expect(t.lastCue()?.original).toBe('sentence 0.03');
  });

  it('says the quota is used up when that is why a chunk failed', async () => {
    const t = setup();
    t.translate.mockRejectedValue(new Error('gemini_quota_exceeded'));
    t.session.acceptAudio({ samples: audio([3, 0.5, 1]), start: 0 });
    t.at(0);
    await t.settle();
    expect(t.main.isPaused).toBe(false);
    t.at(1);
    expect(t.statuses.at(-1)).toBe('gemini_quota_exceeded');
  });

  it('names the provider and reason of any failure the error says, for the overlay to explain', async () => {
    const t = setup();
    t.translate.mockRejectedValue(new Error('groq_rate_limited'));
    t.session.acceptAudio({ samples: audio([3, 0.5, 1]), start: 0 });
    t.at(0);
    await t.settle();
    t.at(1);
    expect(t.statuses.at(-1)).toBe('groq_rate_limited');

    expect(readAheadFailure('background_timeout')).toBe('page_timeout');
    expect(readAheadFailure('web_translation_provider_unavailable')).toBe('web_translation_failed');
    expect(readAheadFailure('groq_invalid_credentials')).toBe('groq_invalid_credentials');
    expect(readAheadFailure('inactive_session')).toBeUndefined();
  });

  it('drops a sentence the model heard in silence', async () => {
    const t = setup();
    t.main.length = 8;
    t.session.acceptAudio({ samples: audio([3, 5]), start: 0 });
    await t.settle();
    t.pending[0]!.resolve([
      { cut: false, end: 3, original: 'Real.', sameLanguage: false, start: 0, translation: '真的。' },
      { cut: false, end: 6.5, original: 'Thank you for listening.', sameLanguage: false, start: 5, translation: '謝謝收聽。' },
    ]);
    await t.settle();
    t.at(1);
    t.at(5.5);
    expect(t.cues.flatMap((cue) => cue ? [cue.original] : [])).toEqual(['Real.']);
  });

  it('shows only the original when the speech is already in the target language', async () => {
    const t = setup();
    t.session.acceptAudio({ samples: audio([3, 0.5, 1]), start: 0 });
    t.pending[0]!.resolve([{ cut: false, end: 3, original: '你好', sameLanguage: true, start: 0, translation: '你好' }]);
    await t.settle();
    t.at(0.5);
    expect(t.lastCue()).toMatchObject({ original: '你好', translation: '' });
  });

  it('stops reading 30 s ahead of the viewer', async () => {
    const t = setup({ autoTranslate: true });
    const pattern: number[] = [];
    for (let i = 0; i < 20; i += 1) pattern.push(3, 0.5);
    t.session.acceptAudio({ samples: audio(pattern), start: 0 });
    await t.settle();
    const translated = t.chunkSeconds().reduce((sum, seconds) => sum + seconds, 0);
    expect(translated).toBeLessThan(30 + 15);
    expect(translated).toBeGreaterThanOrEqual(30);
    expect(t.source.setRunning).toHaveBeenLastCalledWith(false, 1);

    const before = t.translate.mock.calls.length;
    t.at(20);
    await t.settle();
    expect(t.translate.mock.calls.length).toBeGreaterThan(before);
  });

  it('makes only the chunk the viewer waits on urgent after a seek', async () => {
    const t = setup({ autoTranslate: true });
    t.main.time = 100;
    t.session.onMainSeeking();
    // Sentences of 2.5 s with 0.4 s pauses, from the 5 s look-back onwards.
    const pattern: number[] = [];
    for (let i = 0; i < 12; i += 1) pattern.push(2.5, 0.4);
    t.session.acceptAudio({ samples: audio(pattern), start: 95 });
    await t.settle();
    const [first, second] = t.chunkSeconds();
    // Reaches past the viewer (100 + 5 s) to the next pause, in one go...
    expect(95 + first!).toBeGreaterThan(105);
    expect(95 + first!).toBeLessThan(108.5);
    // ...and the next one is a full-size chunk, not another short one.
    expect(second).toBeGreaterThanOrEqual(10);
  });

  it('lets the source read at double speed until it is 30 s ahead', async () => {
    const t = setup({ autoTranslate: true });
    t.main.rate = 1.5;
    t.at(0);
    expect(t.source.setRunning).toHaveBeenLastCalledWith(true, 3);
  });

  it('asks the source for audio again on a seek back past the audio it kept', async () => {
    const t = setup({ autoTranslate: true });
    const pattern: number[] = [];
    for (let i = 0; i < 30; i += 1) pattern.push(2.5, 0.5);
    t.session.acceptAudio({ samples: audio(pattern), start: 0 });
    t.main.time = 80;
    t.session.onMainSeeking();
    await t.settle();
    const before = t.translate.mock.calls.length;
    t.main.time = 40;
    t.session.onMainSeeking();
    expect(t.source.seek).toHaveBeenLastCalledWith(35);
    // The source sends it again; reading resumes without a refill.
    t.session.acceptAudio({ samples: audio(pattern).subarray(35 * SAMPLE_RATE), start: 35 });
    await t.settle();
    expect(t.translate.mock.calls.length).toBeGreaterThan(before);
    expect(t.source.refill).not.toHaveBeenCalled();
  });

  it('asks the source for audio again when a hold gets none for 3 s', () => {
    const t = setup();
    t.main.time = 50;
    t.session.onMainSeeking();
    t.deliver();
    expect(t.main.isPaused).toBe(true);
    t.clock.now = 2500;
    t.at(50);
    expect(t.source.refill).not.toHaveBeenCalled();
    t.clock.now = 3100;
    t.at(50);
    expect(t.source.refill).toHaveBeenCalledWith(50);
  });

  it('translates audio that a hole cuts short, and re-reads the hole when the viewer is held in it', async () => {
    const t = setup({ autoTranslate: true });
    t.at(0);
    // Speech with no pause, then a hole from 2.75 to 4.75 s.
    t.session.acceptAudio({ samples: audio([2.75]), start: 0 });
    expect(t.translate).not.toHaveBeenCalled();
    t.session.acceptAudio({ samples: audio([2.5, 0.5, 4, 0.5, 4, 0.5]), start: 4.75 });
    await t.settle();
    expect(t.chunkSeconds()[0]).toBeCloseTo(2.75, 2);
    expect(t.main.isPaused).toBe(false);

    t.at(3);
    expect(t.main.isPaused).toBe(true);
    t.clock.now = 3100;
    t.at(3);
    expect(t.source.refill).toHaveBeenCalledWith(3);
    // The hole arrives again; it is read and the viewer is released.
    t.session.acceptAudio({ samples: audio([2]), start: 2.75 });
    await t.settle();
    t.at(3);
    expect(t.main.isPaused).toBe(false);
  });

  it('re-reads a hole the viewer is held just before, still inside the chunk before it', async () => {
    const t = setup({ autoTranslate: true });
    t.at(0);
    t.session.acceptAudio({ samples: audio([2.75]), start: 0 });
    t.session.acceptAudio({ samples: audio([2.5, 0.5, 4, 0.5, 4, 0.5]), start: 4.75 });
    await t.settle();

    // 0.05 s before the hole: the chunk before it still covers the viewer,
    // but not far enough to play on.
    t.at(2.7);
    expect(t.main.isPaused).toBe(true);
    t.clock.now = 3100;
    t.at(2.7);
    expect(t.source.refill).toHaveBeenCalledWith(2.7);
    t.session.acceptAudio({ samples: audio([2]), start: 2.75 });
    await t.settle();
    t.at(2.7);
    expect(t.main.isPaused).toBe(false);
  });

  it('reads a hole the cursor skipped once its audio arrives, when the viewer is held before it', async () => {
    const t = setup({ autoTranslate: true });
    t.at(0);
    t.session.acceptAudio({ samples: audio([2.75]), start: 0 });
    t.session.acceptAudio({ samples: audio([2.5, 0.5, 4, 0.5, 4, 0.5]), start: 4.75 });
    await t.settle();
    // The hole's audio comes late, after reading moved past it.
    t.session.acceptAudio({ samples: audio([2]), start: 2.75 });
    await t.settle();

    t.at(2.7);
    await t.settle();
    t.at(2.7);
    expect(t.main.isPaused).toBe(false);
    expect(t.source.refill).not.toHaveBeenCalled();
  });

  it('dispose resumes a player it was holding', () => {
    const t = setup();
    t.at(0);
    expect(t.main.isPaused).toBe(true);
    t.session.dispose();
    expect(t.main.isPaused).toBe(false);
  });
});

describe('decideCut', () => {
  // Pauses of 0.3 s at 10.5, 0.8 s at 12 and 0.4 s at 14.
  const speech = audio([10.5, 0.3, 1.2, 0.8, 1.2, 0.4, 3]);

  it('cuts a comfortable chunk at the longest pause between 10 and 15 s', () => {
    const cut = decideCut(speech, { final: false });
    expect(cut?.hard).toBe(false);
    expect(cut!.samples / SAMPLE_RATE).toBeCloseTo(12.4, 1);
  });

  it('waits for 15 s of audio before choosing', () => {
    expect(decideCut(speech.subarray(0, 14 * SAMPLE_RATE), { final: false })).toBeUndefined();
  });

  it('cuts an urgent chunk at the first pause after 2 s', () => {
    const cut = decideCut(audio([1, 0.4, 2, 0.4, 3]), { final: false, urgentAfter: 0 });
    expect(cut!.samples / SAMPLE_RATE).toBeCloseTo(3.6, 1);
  });

  it('cuts an urgent chunk past the viewer when it starts behind them', () => {
    const cut = decideCut(audio([1, 0.4, 2, 0.4, 3, 0.4, 2]), { final: false, urgentAfter: 5 });
    expect(cut!.samples / SAMPLE_RATE).toBeCloseTo(7, 1);
  });

  it('hard-cuts at 15 s when there is no pause', () => {
    expect(decideCut(audio([20]), { final: false })).toEqual({ hard: true, samples: 15 * SAMPLE_RATE });
  });

  it('takes everything left at the end of the media', () => {
    expect(decideCut(audio([4]), { final: true })).toEqual({ hard: false, samples: 4 * SAMPLE_RATE });
  });
});
