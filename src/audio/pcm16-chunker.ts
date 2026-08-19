function toPcm16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(clamped < 0 ? clamped * 32_768 : clamped * 32_767);
}

function toArrayBuffer(samples: number[]): ArrayBuffer {
  const typed = Int16Array.from(samples);
  return typed.buffer.slice(
    typed.byteOffset,
    typed.byteOffset + typed.byteLength,
  ) as ArrayBuffer;
}

export class Pcm16Chunker {
  private readonly chunkSamples: number;
  private readonly pendingPcm: number[] = [];

  constructor(sampleRate: number, chunkDurationMs = 40) {
    if (
      !Number.isFinite(sampleRate) ||
      sampleRate <= 0 ||
      !Number.isFinite(chunkDurationMs) ||
      chunkDurationMs <= 0
    ) {
      throw new RangeError('Sample rate and chunk duration must be positive');
    }
    this.chunkSamples = Math.round(
      sampleRate * (chunkDurationMs / 1_000),
    );
    if (this.chunkSamples < 1) {
      throw new RangeError('Chunk duration must contain at least one sample');
    }
  }

  push(input: Float32Array): ArrayBuffer[] {
    for (const sample of input) this.pendingPcm.push(toPcm16(sample));

    const chunks: ArrayBuffer[] = [];
    while (this.pendingPcm.length >= this.chunkSamples) {
      chunks.push(toArrayBuffer(this.pendingPcm.splice(0, this.chunkSamples)));
    }
    return chunks;
  }

  flush(): ArrayBuffer | undefined {
    if (this.pendingPcm.length === 0) return undefined;
    return toArrayBuffer(this.pendingPcm.splice(0));
  }
}
