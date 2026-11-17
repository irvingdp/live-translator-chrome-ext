// The Opus frames the buffer tap has seen, kept compressed (~16 KB/s) for as
// long as YouTube keeps the same audio in its SourceBuffer. YouTube never
// appends audio it still holds, so seeking back into its buffer produces no
// new appends: these frames are the only way to read that audio again.
// Mirroring YouTube's buffer (rather than keeping everything) bounds memory to
// what Chrome lets one audio SourceBuffer hold, and anything YouTube drops it
// will download and append again when needed. See docs/adr/0001.
import type { OpusFrame } from './webm-opus-demuxer';

// Frames further apart than this are separate stretches of audio.
const MAX_FRAME_GAP_SECONDS = 0.1;
// Frame timestamps are rounded to this when deciding two frames are the same.
const SAME_FRAME_SECONDS = 0.001;
// Buffered ranges are compared with this much slack: SourceBuffer.buffered is
// rounded and may end a frame short of the last frame's start.
const RANGE_SLACK_SECONDS = 0.05;

export class OpusFrameStore {
  private frames: OpusFrame[] = [];

  get size(): number {
    return this.frames.length;
  }

  add(frames: OpusFrame[]): void {
    for (const frame of frames) {
      const index = this.indexAtOrAfter(frame.timestamp - SAME_FRAME_SECONDS);
      const existing = this.frames[index];
      if (existing && Math.abs(existing.timestamp - frame.timestamp) < SAME_FRAME_SECONDS) {
        // Appended again after YouTube evicted and re-fetched it.
        this.frames[index] = frame;
      } else {
        this.frames.splice(index, 0, frame);
      }
    }
  }

  // Keeps only frames inside `ranges` ([start, end] seconds), i.e. what the
  // SourceBuffer still reports as buffered.
  retain(ranges: Array<[number, number]>): void {
    this.frames = this.frames.filter(({ timestamp }) =>
      ranges.some(([start, end]) =>
        timestamp >= start - RANGE_SLACK_SECONDS && timestamp < end + RANGE_SLACK_SECONDS));
  }

  clear(): void {
    this.frames = [];
  }

  // The contiguous run of frames that starts within `lookahead` seconds of
  // `from`, up to `to` or the first gap.
  run(from: number, to: number, lookahead = 0): OpusFrame[] {
    let index = this.indexAtOrAfter(from - SAME_FRAME_SECONDS);
    const first = this.frames[index];
    if (!first || first.timestamp > from + lookahead) return [];
    const run: OpusFrame[] = [];
    let previous = first.timestamp;
    for (; index < this.frames.length; index += 1) {
      const frame = this.frames[index]!;
      if (frame.timestamp >= to) break;
      if (frame.timestamp - previous > MAX_FRAME_GAP_SECONDS) break;
      run.push(frame);
      previous = frame.timestamp;
    }
    return run;
  }

  private indexAtOrAfter(timestamp: number): number {
    let low = 0;
    let high = this.frames.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.frames[middle]!.timestamp < timestamp) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}
