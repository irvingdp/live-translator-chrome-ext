import { describe, expect, it, vi } from 'vitest';

import { CaptionTrackSession } from '../../src/read-ahead/caption-track-session';
import type { CaptionSentence } from '../../src/read-ahead/caption-track';
import type { DisplayedCue, MainPlayer, ReadAheadStatus } from '../../src/read-ahead/read-ahead-session';

class FakeMain implements MainPlayer {
  time = 0;
  isPaused = false;
  ad = false;
  events: Array<'pause' | 'play'> = [];
  adPlaying() { return this.ad; }
  currentTime() { return this.time; }
  duration() { return 600; }
  paused() { return this.isPaused; }
  playbackRate() { return 1; }
  pause() { this.isPaused = true; this.events.push('pause'); }
  play() { this.isPaused = false; this.events.push('play'); }
}

// One sentence every 5 s, 4 s long.
const sentences: CaptionSentence[] = Array.from({ length: 20 }, (_, index) => ({
  end: index * 5 + 4,
  original: `s${index}`,
  start: index * 5,
}));

function setup(options: { sameLanguage?: boolean; translations?: string[] } = {}) {
  const main = new FakeMain();
  const cues: Array<DisplayedCue | undefined> = [];
  const statuses: ReadAheadStatus[] = [];
  const pending: Array<{ reject(error: unknown): void; resolve(texts: string[]): void; texts: string[] }> = [];
  const translate = vi.fn((texts: string[]) =>
    new Promise<string[]>((resolve, reject) => pending.push({ reject, resolve, texts })));
  const session = new CaptionTrackSession({
    main,
    sameLanguage: options.sameLanguage ?? false,
    sentences,
    showCue: (cue) => cues.push(cue),
    showStatus: (status) => statuses.push(status),
    translate,
    ...(options.translations ? { translations: options.translations } : {}),
  });
  // Media elements report pause/play asynchronously; deliver them like that.
  const deliver = () => {
    for (const event of main.events.splice(0)) {
      if (event === 'pause') session.onMainPause();
      else session.onMainPlay();
    }
  };
  const answer = async (index = 0) => {
    const request = pending.splice(index, 1)[0]!;
    request.resolve(request.texts.map((text) => `譯${text}`));
    await Promise.resolve();
    await Promise.resolve();
  };
  return { answer, cues, deliver, main, pending, session, statuses, translate };
}

describe('CaptionTrackSession', () => {
  it('translates a batch at a time up to 30 s ahead, holding the viewer until the first arrives', async () => {
    const { answer, cues, deliver, main, pending, session, statuses } = setup();
    session.tick();
    deliver();
    // Two batches in flight: 0–15 s and 15–30 s.
    expect(pending.map((request) => request.texts)).toEqual([['s0', 's1', 's2'], ['s3', 's4', 's5']]);
    expect(main.isPaused).toBe(true);
    expect(statuses.at(-1)).toBe('translating');

    await answer();
    deliver();
    expect(main.isPaused).toBe(false);
    expect(cues.at(-1)).toEqual({ id: 'caption-track-0', original: 's0', translation: '譯s0' });
    expect(statuses.at(-1)).toBeUndefined();
    // The next batch waits until it is within 30 s of the viewer.
    expect(pending).toHaveLength(1);
    main.time = 1;
    session.tick();
    expect(pending[1]!.texts).toEqual(['s6', 's7', 's8']);
  });

  it('needs no translator with a target-language track, and shows a seek target at once', () => {
    const { cues, main, session, translate } = setup({ translations: sentences.map((s) => `T${s.original}`) });
    main.time = 72;
    session.onMainSeeking();
    expect(translate).not.toHaveBeenCalled();
    expect(main.isPaused).toBe(false);
    expect(cues.at(-1)).toEqual({ id: 'caption-track-14', original: 's14', translation: 'Ts14' });
  });

  it('shows the original alone when it is already in the target language', () => {
    const { cues, session, translate } = setup({ sameLanguage: true });
    session.tick();
    expect(translate).not.toHaveBeenCalled();
    expect(cues.at(-1)).toEqual({ id: 'caption-track-0', original: 's0', translation: '' });
  });

  it('translates from where the viewer seeks to', () => {
    const { main, pending, session } = setup();
    main.time = 61;
    session.onMainSeeking();
    expect(pending[0]!.texts).toEqual(['s12', 's13', 's14']);
  });

  it('shows a failed batch with its original and the reason, without holding or retrying', async () => {
    const { cues, deliver, main, pending, session, statuses, translate } = setup();
    session.tick();
    deliver();
    pending.shift()!.reject(new Error('translator_unsupported'));
    await Promise.resolve();
    await Promise.resolve();
    deliver();
    expect(main.isPaused).toBe(false);
    expect(cues.at(-1)).toEqual({ id: 'caption-track-0', original: 's0', translation: '' });
    expect(statuses.at(-1)).toBe('translator_unsupported');
    session.tick();
    expect(translate.mock.calls.filter(([texts]) => texts[0] === 's0')).toHaveLength(1);
  });

  it('translates a failed sentence again when the viewer seeks back to it', async () => {
    const { answer, cues, deliver, main, pending, session, translate } = setup();
    session.tick();
    deliver();
    pending.shift()!.reject(new Error('web_translation_timeout'));
    await Promise.resolve();
    await Promise.resolve();
    main.time = 10;
    session.tick();
    while (pending.length > 0) await answer();
    expect(translate.mock.calls.filter(([texts]) => texts[0] === 's0')).toHaveLength(1);

    main.time = 1;
    session.onMainSeeking();
    expect(translate.mock.calls.filter(([texts]) => texts[0] === 's0')).toHaveLength(2);
    await answer(pending.findIndex((request) => request.texts[0] === 's0'));
    deliver();
    expect(cues.at(-1)).toEqual({ id: 'caption-track-0', original: 's0', translation: '譯s0' });
  });

  it('keeps a viewer pause during a hold, and lets the video go on dispose', async () => {
    const { answer, deliver, main, session } = setup();
    session.tick();
    deliver();
    main.isPaused = true;
    session.onMainPause();
    await answer();
    deliver();
    expect(main.isPaused).toBe(true);

    const other = setup();
    other.session.tick();
    other.deliver();
    other.session.dispose();
    expect(other.main.isPaused).toBe(false);
  });

  it('shows nothing during an ad', () => {
    const { cues, main, session } = setup({ sameLanguage: true });
    main.ad = true;
    session.tick();
    expect(cues).toEqual([]);
  });
});
