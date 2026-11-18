// What every buffer tap does once it has decoded audio (GLOSSARY.md: Buffer
// tap): mix to mono, resample to read-ahead's 16 kHz, and post it to the
// isolated-world read-ahead script in blocks of contiguous audio stamped with
// media time. Shared by the YouTube tap and the MediaSource tap (ADR 0009).

export const OUTPUT_RATE = 16_000;
const FLUSH_MS = 200;
const MAX_BLOCK_SECONDS = 2;
const CONTIGUITY_SECONDS = 0.03;

// Chrome's AudioDecoder stamps its output by counting samples from its first
// input, not from each input's timestamp, so after a jump its output would
// carry the wrong media time. A jump in input timestamps therefore gets a
// fresh decoder.
export const MAX_FRAME_GAP_SECONDS = 0.1;

export function planesOf(data: AudioData): Float32Array[] {
  return Array.from({ length: data.numberOfChannels }, (_, planeIndex) => {
    const plane = new Float32Array(data.numberOfFrames);
    data.copyTo(plane, { format: 'f32-planar', planeIndex });
    return plane;
  });
}

// Mono at 16 kHz: averaging for whole ratios (48 and 32 kHz), linear
// interpolation otherwise (44.1 kHz). Speech recognition needs no better
// anti-alias filter than that.
export function toMono16k(planes: Float32Array[], sampleRate: number): Float32Array {
  const frames = planes[0]?.length ?? 0;
  const mixed = new Float32Array(frames);
  for (const plane of planes) {
    for (let index = 0; index < frames; index += 1) mixed[index]! += plane[index]! / planes.length;
  }
  const ratio = sampleRate / OUTPUT_RATE;
  const output = new Float32Array(Math.floor(frames / ratio));
  if (Number.isInteger(ratio)) {
    for (let index = 0; index < output.length; index += 1) {
      let sum = 0;
      for (let offset = 0; offset < ratio; offset += 1) sum += mixed[index * ratio + offset]!;
      output[index] = sum / ratio;
    }
    return output;
  }
  for (let index = 0; index < output.length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(frames - 1, left + 1);
    const weight = position - left;
    output[index] = mixed[left]! * (1 - weight) + mixed[right]! * weight;
  }
  return output;
}

export interface AudioEmitter {
  emit(start: number, samples: Float32Array): void;
  flush(): void;
  // Drops what is waiting (read-ahead stopped).
  reset(): void;
}

// Batches decoded audio into blocks: contiguous, at most MAX_BLOCK_SECONDS,
// sent FLUSH_MS after the first piece. `post` transfers each block.
export function createAudioEmitter(
  view: Window,
  post: (start: number, samples: Float32Array) => void,
): AudioEmitter {
  let pending: { end: number; parts: Float32Array[]; start: number } | undefined;
  let timer: number | undefined;

  const flush = () => {
    if (timer !== undefined) view.clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    const length = pending.parts.reduce((sum, part) => sum + part.length, 0);
    const samples = new Float32Array(length);
    let offset = 0;
    for (const part of pending.parts) {
      samples.set(part, offset);
      offset += part.length;
    }
    const { start } = pending;
    pending = undefined;
    post(start, samples);
  };

  return {
    emit(start, samples) {
      if (samples.length === 0) return;
      const end = start + samples.length / OUTPUT_RATE;
      if (pending && (Math.abs(pending.end - start) > CONTIGUITY_SECONDS ||
        pending.end - pending.start > MAX_BLOCK_SECONDS)) flush();
      if (pending) {
        pending.parts.push(samples);
        pending.end = end;
      } else {
        pending = { end, parts: [samples], start };
      }
      timer ??= view.setTimeout(flush, FLUSH_MS);
    },
    flush,
    reset() {
      if (timer !== undefined) view.clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}
