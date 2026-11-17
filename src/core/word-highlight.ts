// Word highlight (GLOSSARY.md, issue #18): which word of a cue's original is
// being said. Shared by the page overlay, which reads the main player's time
// directly, and the side panel, which works it out from a playback clock.
import type { CaptionWord } from './caption-window';

// The word being said at `time`: the last one that has started, or -1 before
// the first. A word stays current through the pause after it.
export function currentWordIndex(words: CaptionWord[], time: number): number {
  let current = -1;
  for (let index = 0; index < words.length; index += 1) {
    if (words[index]!.start <= time) current = index;
    else break;
  }
  return current;
}

export type WordState = 'current' | 'said' | 'upcoming';

export function wordState(index: number, current: number): WordState {
  return index < current ? 'said' : index === current ? 'current' : 'upcoming';
}

// The main player's time as last reported by the page, for a context that
// cannot read it (the side panel): it runs on at `rate` unless paused.
export interface PlaybackClock {
  // Date.now() when `time` was read.
  at: number;
  paused: boolean;
  rate: number;
  time: number;
}

export function clockTime(clock: PlaybackClock, now: number): number {
  return clock.paused ? clock.time : clock.time + Math.max(0, now - clock.at) / 1000 * clock.rate;
}
