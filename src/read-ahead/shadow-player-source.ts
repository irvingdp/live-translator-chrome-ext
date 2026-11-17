// Shadow player (GLOSSARY.md) for plain HTML5 video: a hidden, muted second
// <video> with the same src plays ahead of the main player. A muted element
// still yields audible samples through captureStream() (2026-11-15 spike).
import type { AudioBlock, ReadAheadSource } from './read-ahead-session';

const OUTPUT_RATE = 16_000;
// Capture timing is read from currentTime, which jitters by a few frames;
// blocks that land this close to where the previous one ended are treated as
// continuous so chunking does not see false gaps.
const JOIN_SECONDS = 0.25;
// Capture arrives in ~20 ms pieces; handing the session one block per piece
// would have it re-copy its growing audio fifty times a second.
const BLOCK_SECONDS = 0.25;

type TrackProcessor = {
  readable: ReadableStream<AudioData>;
};
type TrackProcessorConstructor = new (init: { track: MediaStreamTrack }) => TrackProcessor;

export class ShadowPlayerSource implements ReadAheadSource {
  private readonly video: HTMLVideoElement;
  private reader?: ReadableStreamDefaultReader<AudioData>;
  private expectedStart?: number;
  private pending?: { parts: Float32Array[]; start: number; seconds: number };
  private disposed = false;

  constructor(
    document: Document,
    src: string,
    private readonly onAudio: (block: AudioBlock) => void,
  ) {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    // Faster playback then just raises the pitch, which resampling back to
    // media time undoes exactly (see stretch()).
    video.preservesPitch = false;
    video.crossOrigin = null;
    video.src = src;
    video.setAttribute('aria-hidden', 'true');
    video.dataset.bilingualShadowPlayer = '';
    // Kept inside the viewport (Chrome may pause muted media scrolled out of
    // view) but invisible and untouchable.
    Object.assign(video.style, {
      bottom: '0',
      height: '2px',
      opacity: '0',
      pointerEvents: 'none',
      position: 'fixed',
      right: '0',
      width: '2px',
      zIndex: '-1',
    });
    document.documentElement.append(video);
    this.video = video;
    video.addEventListener('seeking', () => {
      this.flush();
      this.expectedStart = undefined;
    });
    video.addEventListener('playing', () => this.startCapture(), { once: true });
  }

  // The shadow player plays its own copy; seeking it is how it gets audio.
  refill(time: number): void {
    this.seek(Math.max(0, time - 5));
  }

  seek(time: number): void {
    if (Math.abs(this.video.currentTime - time) > 0.05) this.video.currentTime = time;
  }

  setRunning(running: boolean, rate: number): void {
    if (this.disposed) return;
    if (Number.isFinite(rate) && rate > 0 && this.video.playbackRate !== rate) {
      this.video.playbackRate = rate;
    }
    if (running && this.video.paused) void this.video.play().catch(() => undefined);
    if (!running && !this.video.paused) this.video.pause();
  }

  dispose(): void {
    this.disposed = true;
    void this.reader?.cancel().catch(() => undefined);
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
  }

  private startCapture(): void {
    const stream = (this.video as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
    const attach = () => {
      const [track] = stream.getAudioTracks();
      if (!track || this.reader) return;
      const Processor = (globalThis as { MediaStreamTrackProcessor?: TrackProcessorConstructor })
        .MediaStreamTrackProcessor;
      if (!Processor) return;
      this.reader = new Processor({ track }).readable.getReader();
      void this.pump();
    };
    attach();
    stream.addEventListener('addtrack', attach);
  }

  private flush(): void {
    const pending = this.pending;
    this.pending = undefined;
    if (pending) this.onAudio({ samples: concat(pending.parts), start: pending.start });
  }

  private async pump(): Promise<void> {
    while (!this.disposed && this.reader) {
      let result: ReadableStreamReadResult<AudioData>;
      try {
        result = await this.reader.read();
      } catch {
        return;
      }
      if (result.done) return;
      const data = result.value;
      try {
        if (this.video.paused || this.video.seeking) continue;
        const samples = resample(data);
        const seconds = samples.length / OUTPUT_RATE;
        // currentTime is where playback is now, i.e. the end of this block.
        const measured = this.video.currentTime - seconds * this.video.playbackRate;
        const start = this.expectedStart !== undefined &&
          Math.abs(measured - this.expectedStart) < JOIN_SECONDS
          ? this.expectedStart
          : measured;
        // At rates other than 1 the captured audio is time-stretched; its
        // length in media time differs from its length in samples.
        const mediaSeconds = seconds * this.video.playbackRate;
        if (this.expectedStart === undefined || start !== this.expectedStart) this.flush();
        this.expectedStart = start + mediaSeconds;
        const block = this.video.playbackRate === 1 ? samples : stretch(samples, mediaSeconds);
        if (this.pending) {
          this.pending.parts.push(block);
          this.pending.seconds += mediaSeconds;
        } else {
          this.pending = { parts: [block], seconds: mediaSeconds, start };
        }
        if (this.pending.seconds >= BLOCK_SECONDS) this.flush();
      } finally {
        data.close();
      }
    }
  }
}

function concat(parts: Float32Array[]): Float32Array {
  const output = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function resample(data: AudioData): Float32Array {
  const frames = data.numberOfFrames;
  const channels = data.numberOfChannels;
  const mono = new Float32Array(frames);
  const plane = new Float32Array(frames);
  for (let channel = 0; channel < channels; channel += 1) {
    data.copyTo(plane, { format: 'f32-planar', planeIndex: channel });
    for (let index = 0; index < frames; index += 1) mono[index]! += plane[index]! / channels;
  }
  return linear(mono, Math.round(frames * OUTPUT_RATE / data.sampleRate));
}

// Maps captured samples onto media time when playing faster or slower, so a
// cue's position in the chunk matches the media.
function stretch(samples: Float32Array, mediaSeconds: number): Float32Array {
  return linear(samples, Math.max(1, Math.round(mediaSeconds * OUTPUT_RATE)));
}

function linear(input: Float32Array, length: number): Float32Array {
  if (length === input.length) return input;
  const output = new Float32Array(length);
  const step = input.length / length;
  for (let index = 0; index < length; index += 1) {
    const position = index * step;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const weight = position - left;
    output[index] = input[left]! * (1 - weight) + input[right]! * weight;
  }
  return output;
}
