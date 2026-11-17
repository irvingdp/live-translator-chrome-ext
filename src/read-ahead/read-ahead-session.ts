// Read-ahead mode's rules, independent of where the audio comes from (buffer
// tap or shadow player) and of the browser: chunking, translation,
// cue timing, holds, seeks and the 30 s lead cap. See GLOSSARY.md and
// docs/adr/0001-read-ahead-via-shadow-player.md for the vocabulary.
import type { ChunkSentence } from './gemini-chunk-translation';

export const SAMPLE_RATE = 16_000;
export const MAX_LEAD_SECONDS = 30;
const SEEK_LOOKBACK_SECONDS = 5;
// The chunk the viewer is waiting on (it starts no more than this ahead of
// them) is urgent: it is cut at the first pause past both MIN_URGENT_SECONDS
// into the chunk and URGENT_PAST_VIEWER_SECONDS past the viewer, so a hold
// lasts about one sentence. Every other chunk is cut at the longest pause
// between 10 and 15 s, to keep requests few (the free tier allows ~15 a
// minute) and sentences whole. Only one chunk is urgent per hold: after a
// start or seek the first chunk reaches back 5 s, and judging urgency by lead
// alone would cut several short ones in a row.
const URGENT_LEAD_SECONDS = 1;
const MIN_URGENT_SECONDS = 2;
// An urgent chunk ends at the first pause past URGENT_PAST_VIEWER_SECONDS
// beyond the viewer, so the next, full-size chunk is translated before they
// get there. If the audio does not reach that far yet (a shadow player still
// filling), it settles for the first pause past URGENT_MIN_PAST_VIEWER_SECONDS
// rather than lengthen the hold.
const URGENT_PAST_VIEWER_SECONDS = 5;
const URGENT_MIN_PAST_VIEWER_SECONDS = 1.5;
// Decoded audio behind the viewer is kept only this long. Seeking further
// back asks the source for it again (source.seek): the buffer tap keeps the
// compressed frames for as long as YouTube buffers them, a shadow player just
// seeks.
const KEEP_BEHIND_SECONDS = SEEK_LOOKBACK_SECONDS + 1;
// A hold with no audio arriving for this long asks the source to fetch it
// again (the buffer tap reloads the player at the viewer's position).
const STALL_MS = 3000;
const MIN_CHUNK_SECONDS = 10;
const MAX_CHUNK_SECONDS = 15;
const HARD_CUT_OVERLAP_SECONDS = 2;
const MIN_PAUSE_SECONDS = 0.3;
const FRAME_SECONDS = 0.01;
const CUE_LINGER_SECONDS = 1;
// Two sentences from overlapping chunks closer than this are the same one.
const DUPLICATE_START_SECONDS = 0.6;
// Blocks this close together are treated as contiguous audio.
const CONTIGUITY_SECONDS = 0.03;
const HOLD_MARGIN_SECONDS = 0.15;
const MAX_IN_FLIGHT = 2;
const MIN_SPOKEN_FRACTION = 0.1;
// A shadow player plays this much faster than the viewer until it is
// MAX_LEAD_SECONDS ahead, so the lead builds without a hold every sentence.
// (The buffer tap ignores it: YouTube already downloads ahead.)
const CATCH_UP_RATE = 2;

export interface AudioBlock {
  samples: Float32Array; // mono, SAMPLE_RATE
  start: number; // media time of samples[0], seconds
}

export interface MainPlayer {
  adPlaying(): boolean;
  currentTime(): number;
  duration(): number;
  pause(): void;
  paused(): boolean;
  play(): void;
  playbackRate(): number;
}

export interface ReadAheadSource {
  // Only the shadow player can be steered; the buffer tap ignores both.
  // `rate` is the playback rate the source should read at.
  seek(time: number): void;
  setRunning(running: boolean, rate: number): void;
  // Asked when a hold gets no audio: the buffer tap cannot otherwise get back
  // audio YouTube already appended (it would not append it again).
  refill(time: number): void;
}

export interface DisplayedCue {
  id: string;
  original: string;
  translation: string;
}

// 'loading': holding for audio; 'translating': holding for the translation
// of audio already read. Shown differently so a long hold says which it is.
// A failed chunk shows 'failed', or the reason when it is worth telling the
// viewer: a provider's quota is used up, or Chrome's built-in Translator cannot
// translate this language pair.
export const READ_AHEAD_FAILURES = [
  'cloudflare_quota_exceeded',
  'gemini_quota_exceeded',
  'groq_quota_exceeded',
  'translator_unsupported',
] as const;
export type ReadAheadFailure = (typeof READ_AHEAD_FAILURES)[number];

export type ReadAheadStatus =
  | 'failed'
  | 'loading'
  | 'translating'
  | ReadAheadFailure
  | undefined;

export interface ReadAheadDependencies {
  main: MainPlayer;
  showCue(cue: DisplayedCue | undefined): void;
  showStatus(status: ReadAheadStatus): void;
  now(): number;
  source: ReadAheadSource;
  translate(samples: Int16Array): Promise<ChunkSentence[]>;
}

interface Chunk {
  // Why a failed chunk failed, when that is worth telling the viewer.
  failure?: ReadAheadFailure;
  end: number; // media time up to which this chunk's cues are complete
  start: number;
  state: 'done' | 'failed' | 'pending';
}

interface Cue extends DisplayedCue {
  end: number;
  start: number;
}

interface Segment {
  samples: Float32Array;
  start: number;
}

interface Cut {
  hard: boolean;
  samples: number;
}

function segmentEnd(segment: Segment): number {
  return segment.start + segment.samples.length / SAMPLE_RATE;
}

function frameLevels(samples: Float32Array): number[] {
  const frame = Math.round(SAMPLE_RATE * FRAME_SECONDS);
  const levels: number[] = [];
  for (let index = 0; index + frame <= samples.length; index += frame) {
    let sum = 0;
    for (let offset = 0; offset < frame; offset += 1) {
      const value = samples[index + offset]!;
      sum += value * value;
    }
    levels.push(Math.sqrt(sum / frame));
  }
  return levels;
}

// Quiet is relative to this audio's noise floor (music beds and room tone are
// never zero), but never so loose that ordinary speech counts as quiet.
function quietThreshold(levels: number[]): number {
  const sorted = [...levels].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)]!;
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return Math.max(0.005, Math.min(floor * 2.5, median * 0.5));
}

// Quiet runs of at least MIN_PAUSE_SECONDS, as [midpoint seconds, length].
function findPauses(samples: Float32Array): Array<[number, number]> {
  const levels = frameLevels(samples);
  if (levels.length === 0) return [];
  const threshold = quietThreshold(levels);
  const minFrames = Math.round(MIN_PAUSE_SECONDS / FRAME_SECONDS);
  const pauses: Array<[number, number]> = [];
  let runStart = -1;
  for (let index = 0; index <= levels.length; index += 1) {
    const quiet = index < levels.length && levels[index]! < threshold;
    if (quiet && runStart < 0) runStart = index;
    if (!quiet && runStart >= 0) {
      const length = index - runStart;
      if (length >= minFrames) {
        pauses.push([(runStart + length / 2) * FRAME_SECONDS, length * FRAME_SECONDS]);
      }
      runStart = -1;
    }
  }
  return pauses;
}

// Where to end the chunk that starts at samples[0], or undefined to wait for
// more audio. `final` means no more audio will follow (end of media).
export function decideCut(
  samples: Float32Array,
  // `urgentAfter`: cut at the first pause at least this many seconds in, or
  // at least `urgentAtLeast` in when the audio does not reach `urgentAfter`.
  options: { final: boolean; urgentAfter?: number; urgentAtLeast?: number },
): Cut | undefined {
  const seconds = samples.length / SAMPLE_RATE;
  if (options.final && seconds <= MAX_CHUNK_SECONDS) {
    return seconds > 0 ? { hard: false, samples: samples.length } : undefined;
  }
  const window = samples.subarray(0, Math.min(samples.length, MAX_CHUNK_SECONDS * SAMPLE_RATE));
  const pauses = findPauses(window);
  if (options.urgentAfter !== undefined) {
    const preferred = Math.max(MIN_URGENT_SECONDS, options.urgentAfter);
    const least = Math.max(MIN_URGENT_SECONDS, Math.min(preferred, options.urgentAtLeast ?? preferred));
    const pause = pauses.find(([middle]) => middle >= preferred) ??
      (seconds < preferred + MIN_PAUSE_SECONDS
        ? pauses.find(([middle]) => middle >= least)
        : undefined);
    if (pause) return { hard: false, samples: Math.round(pause[0] * SAMPLE_RATE) };
  } else if (seconds >= MAX_CHUNK_SECONDS) {
    const candidates = pauses.filter(([middle]) =>
      middle >= MIN_CHUNK_SECONDS && middle <= MAX_CHUNK_SECONDS);
    if (candidates.length > 0) {
      const [middle] = candidates.reduce((best, pause) => pause[1] > best[1] ? pause : best);
      return { hard: false, samples: Math.round(middle * SAMPLE_RATE) };
    }
  }
  if (seconds >= MAX_CHUNK_SECONDS) {
    return { hard: true, samples: MAX_CHUNK_SECONDS * SAMPLE_RATE };
  }
  return undefined;
}

function toPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    pcm[index] = Math.max(-1, Math.min(1, samples[index]!)) * 32767;
  }
  return pcm;
}

export class ReadAheadSession {
  private readonly segments: Segment[] = [];
  private readonly chunks: Chunk[] = [];
  private readonly cues: Cue[] = [];
  private cursor: number;
  // Whether the chunk that starts at `cursor` starts mid-speech (after a hard
  // cut, a start or a seek), so a sentence it flags as cut is a fragment.
  private cursorIsHard = true;
  private holding = false;
  private resumeAfterHold = false;
  private expectedPauses = 0;
  private expectedPlays = 0;
  private inFlight = 0;
  private cueSequence = 0;
  private disposed = false;
  // When the current hold began waiting for audio, for stall recovery.
  private starvedSince?: number;
  private shownCueId?: string;
  private shownStatus: ReadAheadStatus;

  constructor(private readonly dependencies: ReadAheadDependencies) {
    this.cursor = Math.max(0, dependencies.main.currentTime() - SEEK_LOOKBACK_SECONDS);
    dependencies.source.seek(this.cursor);
  }

  dispose(): void {
    this.disposed = true;
    this.dependencies.source.setRunning(false, 1);
    if (this.holding && this.resumeAfterHold) this.dependencies.main.play();
    this.holding = false;
  }

  acceptAudio(block: AudioBlock): void {
    if (this.disposed || block.samples.length === 0) return;
    let { samples, start } = block;
    // Keep only what no stored segment already holds (YouTube re-appends
    // audio it already sent after a seek back).
    for (const segment of this.segments) {
      const end = segmentEnd(segment);
      if (start >= segment.start - CONTIGUITY_SECONDS && start < end - CONTIGUITY_SECONDS) {
        const skip = Math.round((end - start) * SAMPLE_RATE);
        if (skip >= samples.length) return;
        samples = samples.subarray(skip);
        start = end;
      }
    }
    const before = this.segments.find((segment) =>
      Math.abs(segmentEnd(segment) - start) <= CONTIGUITY_SECONDS);
    if (before) {
      const joined = new Float32Array(before.samples.length + samples.length);
      joined.set(before.samples);
      joined.set(samples, before.samples.length);
      before.samples = joined;
    } else {
      this.segments.push({ samples: samples.slice(), start });
      this.segments.sort((a, b) => a.start - b.start);
    }
    this.mergeSegments();
    this.tick();
  }

  onMainPause(): void {
    if (this.expectedPauses > 0) {
      this.expectedPauses -= 1;
      return;
    }
    // A viewer pause, even during a hold, means "stay paused".
    this.resumeAfterHold = false;
    this.tick();
  }

  onMainPlay(): void {
    if (this.expectedPlays > 0) {
      this.expectedPlays -= 1;
      return;
    }
    this.resumeAfterHold = true;
    this.tick();
  }

  onMainSeeking(): void {
    if (this.disposed) return;
    const time = this.dependencies.main.currentTime();
    if (this.chunkAt(time, true)) {
      // Cached or on its way: keep reading from where that stretch ends.
      const end = this.chainEnd(time, true);
      if (end !== this.cursor) {
        this.cursor = end;
        this.cursorIsHard = true;
        this.dependencies.source.seek(end);
      }
    } else {
      this.cursor = this.rereadPoint(time);
      this.cursorIsHard = true;
      this.dependencies.source.seek(this.cursor);
    }
    this.tick();
  }

  tick(): void {
    if (this.disposed) return;
    const { main } = this.dependencies;
    if (main.adPlaying()) {
      this.render(undefined, undefined);
      this.dependencies.source.setRunning(false, main.playbackRate());
      return;
    }
    const time = main.currentTime();
    this.updateHold(time);
    this.recoverStall(time);
    this.issueChunks(time);
    this.pruneAudio(time);
    const wantsPlayback = this.holding ? this.resumeAfterHold : !main.paused();
    const ahead = this.contiguousEnd(this.cursor) - time;
    this.dependencies.source.setRunning(
      wantsPlayback && ahead < MAX_LEAD_SECONDS + MAX_CHUNK_SECONDS,
      main.playbackRate() * (ahead < MAX_LEAD_SECONDS ? CATCH_UP_RATE : 1),
    );
    const chunk = this.chunkAt(time, false);
    this.render(
      this.cueAt(time),
      this.holding
        ? this.chainEnd(time, true) > time ? 'translating' : 'loading'
        : chunk?.state === 'failed' ? chunk.failure ?? 'failed' : undefined,
    );
  }

  private updateHold(time: number): void {
    const { main } = this.dependencies;
    const nearEnd = main.duration() - time < HOLD_MARGIN_SECONDS * 2;
    const ready = nearEnd || this.chainEnd(time, false) - time >= HOLD_MARGIN_SECONDS;
    if (!this.holding) {
      if (ready || main.paused()) return;
      this.holding = true;
      this.resumeAfterHold = true;
      this.pauseMain();
      return;
    }
    if (!ready) {
      // The viewer pressed play during the hold: keep holding, but resume
      // once the translation arrives.
      if (!main.paused()) this.pauseMain();
      return;
    }
    this.holding = false;
    if (this.resumeAfterHold && main.paused()) {
      this.expectedPlays += 1;
      main.play();
    }
  }

  private recoverStall(time: number): void {
    // Nothing to read at the cursor, or nothing at all where the viewer is
    // held (audio missing there while the cursor moved on past it).
    const cursorStarving = !this.chunkAt(this.cursor, true) &&
      !this.contiguousFrom(this.cursor) &&
      !this.segments.some((segment) =>
        segment.start > this.cursor && segment.start - this.cursor <= SEEK_LOOKBACK_SECONDS + 1);
    const viewerUncovered = !this.chunkAt(time, true) && !this.contiguousFrom(time);
    if (!this.holding || !(cursorStarving || viewerUncovered)) {
      this.starvedSince = undefined;
      return;
    }
    const now = this.dependencies.now();
    this.starvedSince ??= now;
    if (now - this.starvedSince < STALL_MS) return;
    this.starvedSince = now;
    if (viewerUncovered) {
      // Read again from just before the viewer once the audio comes back.
      this.cursor = this.rereadPoint(time);
      this.cursorIsHard = true;
    }
    this.dependencies.source.refill(time);
  }

  // Where to start reading for a viewer at `time` that no chunk covers: 5 s
  // before, or the end of a chunk that ends in between.
  private rereadPoint(time: number): number {
    const lookback = Math.max(0, time - SEEK_LOOKBACK_SECONDS);
    return this.chunks
      .filter((chunk) => chunk.end > lookback && chunk.end <= time)
      .reduce((latest, chunk) => Math.max(latest, chunk.end), lookback);
  }

  private pauseMain(): void {
    this.expectedPauses += 1;
    this.dependencies.main.pause();
  }

  private issueChunks(time: number): void {
    while (this.inFlight < MAX_IN_FLIGHT && this.cursor - time < MAX_LEAD_SECONDS) {
      // Skip stretches an earlier chunk already covers or is covering.
      const existing = this.chunkAt(this.cursor, true);
      if (existing) {
        this.cursor = this.chainEnd(this.cursor, true);
        continue;
      }
      let samples = this.contiguousFrom(this.cursor);
      if (!samples) {
        // After a seek the source may only have audio from a little later
        // (the buffer tap cannot reach back): start where it begins.
        const next = this.segments.find((segment) =>
          segment.start > this.cursor && segment.start - this.cursor <= SEEK_LOOKBACK_SECONDS + 1);
        // Never skip a hole the viewer is in: that audio is needed, and a
        // refill brings it back.
        if (!next || (this.cursor <= time && time < next.start)) return;
        this.cursor = next.start;
        this.cursorIsHard = true;
        samples = this.contiguousFrom(this.cursor)!;
      }
      const nextChunk = this.chunks
        .filter((chunk) => chunk.start > this.cursor)
        .reduce((earliest, chunk) => Math.min(earliest, chunk.start), Infinity);
      const limit = Math.min(samples.length, Math.round((nextChunk - this.cursor) * SAMPLE_RATE));
      const audioEnd = this.cursor + samples.length / SAMPLE_RATE;
      // Audio followed shortly by more audio, with a hole in between, will
      // not grow from here: it is translated as is, and reading skips the
      // hole (a refill re-reads it if the viewer is held there).
      const final = audioEnd >= this.dependencies.main.duration() - CONTIGUITY_SECONDS ||
        limit < samples.length ||
        this.segments.some((segment) => segment.start > audioEnd &&
          segment.start - audioEnd <= SEEK_LOOKBACK_SECONDS + 1);
      const cut = decideCut(samples.subarray(0, limit), {
        final,
        ...(this.cursor - time <= URGENT_LEAD_SECONDS
          ? {
              urgentAfter: time + URGENT_PAST_VIEWER_SECONDS - this.cursor,
              urgentAtLeast: time + URGENT_MIN_PAST_VIEWER_SECONDS - this.cursor,
            }
          : {}),
      });
      if (!cut) return;
      const start = this.cursor;
      const cutTime = start + cut.samples / SAMPLE_RATE;
      const chunk: Chunk = {
        end: cut.hard ? cutTime - HARD_CUT_OVERLAP_SECONDS : cutTime,
        start,
        state: 'pending',
      };
      this.chunks.push(chunk);
      const startsHard = this.cursorIsHard;
      this.cursor = chunk.end;
      this.cursorIsHard = cut.hard || limit < samples.length;
      void this.translateChunk(chunk, samples.slice(0, cut.samples), startsHard, cut.hard);
    }
  }

  private async translateChunk(
    chunk: Chunk,
    samples: Float32Array,
    startsHard: boolean,
    endsHard: boolean,
  ): Promise<void> {
    this.inFlight += 1;
    const pcm = toPcm16(samples);
    // One attempt only (no retries): a failed chunk shows "翻譯失敗" rather
    // than holding the viewer for another request.
    let sentences: ChunkSentence[] | undefined;
    let failure: ReadAheadFailure | undefined;
    try {
      sentences = await this.dependencies.translate(pcm);
    } catch (error) {
      sentences = undefined;
      const reason = error instanceof Error ? error.message : undefined;
      failure = READ_AHEAD_FAILURES.find((known) => known === reason);
    }
    this.inFlight -= 1;
    if (this.disposed) return;
    if (!sentences) {
      chunk.state = 'failed';
      if (failure) chunk.failure = failure;
    } else {
      chunk.state = 'done';
      this.addCues(chunk, sentences, startsHard, endsHard, samples);
    }
    this.tick();
  }

  private addCues(
    chunk: Chunk,
    sentences: ChunkSentence[],
    startsHard: boolean,
    endsHard: boolean,
    samples: Float32Array,
  ): void {
    const length = samples.length / SAMPLE_RATE;
    const levels = frameLevels(samples);
    const threshold = levels.length > 0 ? quietThreshold(levels) : 0;
    // The model sometimes "hears" a stock phrase in silence (a closing
    // "Thank you for listening." over a quiet ending); a sentence whose span
    // is almost all quiet is dropped.
    const spoken = (start: number, end: number) => {
      const from = Math.max(0, Math.floor(start / FRAME_SECONDS));
      const to = Math.min(levels.length, Math.ceil(end / FRAME_SECONDS));
      if (to <= from) return true;
      let loud = 0;
      for (let index = from; index < to; index += 1) if (levels[index]! >= threshold) loud += 1;
      return loud / (to - from) >= MIN_SPOKEN_FRACTION;
    };
    const sorted = [...sentences].sort((a, b) => a.start - b.start);
    sorted.forEach((sentence, index) => {
      // A fragment is only dropped at an edge that cut through speech; the
      // neighbouring chunk overlaps that edge and carries the whole sentence.
      if (sentence.cut && index === 0 && startsHard) return;
      if (sentence.cut && index === sorted.length - 1 && endsHard) return;
      const start = chunk.start + Math.max(0, Math.min(length, sentence.start));
      if (this.cues.some((cue) => Math.abs(cue.start - start) < DUPLICATE_START_SECONDS)) return;
      if (!sentence.original && !sentence.translation) return;
      if (!spoken(sentence.start, Math.max(sentence.start, sentence.end))) return;
      this.cues.push({
        end: chunk.start + Math.max(sentence.start, sentence.end) + CUE_LINGER_SECONDS,
        id: `read-ahead-${++this.cueSequence}`,
        original: sentence.original,
        start,
        translation: sentence.sameLanguage ? '' : sentence.translation,
      });
    });
    this.cues.sort((a, b) => a.start - b.start);
  }

  private cueAt(time: number): Cue | undefined {
    let found: Cue | undefined;
    for (let index = 0; index < this.cues.length; index += 1) {
      const cue = this.cues[index]!;
      if (cue.start > time) break;
      const next = this.cues[index + 1];
      const end = next ? Math.min(cue.end, next.start) : cue.end;
      if (time < end) found = cue;
    }
    return found;
  }

  private render(cue: Cue | undefined, status: ReadAheadStatus): void {
    if (cue?.id !== this.shownCueId) {
      this.shownCueId = cue?.id;
      this.dependencies.showCue(cue && {
        id: cue.id,
        original: cue.original,
        translation: cue.translation,
      });
    }
    if (status !== this.shownStatus) {
      this.shownStatus = status;
      this.dependencies.showStatus(status);
    }
  }

  // The finished (or failed) chunk containing `time`; with `includePending`,
  // also one still being translated.
  private chunkAt(time: number, includePending: boolean): Chunk | undefined {
    return this.chunks.find((chunk) =>
      (includePending || chunk.state !== 'pending') &&
      chunk.start <= time + CONTIGUITY_SECONDS && time < chunk.end);
  }

  // How far media time stays covered by back-to-back chunks from `time`.
  private chainEnd(time: number, includePending: boolean): number {
    let end = time;
    for (;;) {
      const chunk = this.chunkAt(end, includePending);
      if (!chunk || chunk.end <= end) return end;
      end = chunk.end;
    }
  }

  private contiguousFrom(time: number): Float32Array | undefined {
    const segment = this.segments.find((item) =>
      item.start <= time + CONTIGUITY_SECONDS && time < segmentEnd(item));
    if (!segment) return undefined;
    const offset = Math.max(0, Math.round((time - segment.start) * SAMPLE_RATE));
    return segment.samples.subarray(offset);
  }

  private contiguousEnd(time: number): number {
    const segment = this.segments.find((item) =>
      item.start <= time + CONTIGUITY_SECONDS && time <= segmentEnd(item) + CONTIGUITY_SECONDS);
    return segment ? segmentEnd(segment) : time;
  }

  private mergeSegments(): void {
    for (let index = 0; index + 1 < this.segments.length;) {
      const current = this.segments[index]!;
      const next = this.segments[index + 1]!;
      if (Math.abs(segmentEnd(current) - next.start) <= CONTIGUITY_SECONDS) {
        const joined = new Float32Array(current.samples.length + next.samples.length);
        joined.set(current.samples);
        joined.set(next.samples, current.samples.length);
        current.samples = joined;
        this.segments.splice(index + 1, 1);
      } else {
        index += 1;
      }
    }
  }

  // Audio already translated, or far behind the viewer, is not needed again.
  private pruneAudio(time: number): void {
    const keepFrom = Math.min(time, this.cursor) - KEEP_BEHIND_SECONDS;
    for (let index = this.segments.length - 1; index >= 0; index -= 1) {
      const segment = this.segments[index]!;
      if (segmentEnd(segment) < keepFrom) {
        this.segments.splice(index, 1);
      } else if (segment.start < keepFrom) {
        const drop = Math.round((keepFrom - segment.start) * SAMPLE_RATE);
        segment.samples = segment.samples.slice(drop);
        segment.start = keepFrom;
      }
    }
  }
}
