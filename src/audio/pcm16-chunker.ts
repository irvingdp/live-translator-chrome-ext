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
  private readonly resampleStep: number;
  private nextSourcePosition = 0;
  private readonly pendingPcm: number[] = [];
  private readonly sourceBuffer: number[] = [];

  constructor(
    sourceSampleRate: number,
    targetSampleRate = 16_000,
    chunkDurationMs = 40,
  ) {
    if (sourceSampleRate <= 0 || targetSampleRate <= 0) {
      throw new RangeError('Sample rates must be positive');
    }
    this.resampleStep = sourceSampleRate / targetSampleRate;
    this.chunkSamples = Math.round(
      targetSampleRate * (chunkDurationMs / 1_000),
    );
  }

  push(input: Float32Array): ArrayBuffer[] {
    this.sourceBuffer.push(...input);

    while (this.canInterpolate(this.nextSourcePosition)) {
      const leftIndex = Math.floor(this.nextSourcePosition);
      const fraction = this.nextSourcePosition - leftIndex;
      const left = this.sourceBuffer[leftIndex] ?? 0;
      const right = this.sourceBuffer[leftIndex + 1] ?? left;
      this.pendingPcm.push(toPcm16(left + (right - left) * fraction));
      this.nextSourcePosition += this.resampleStep;
    }

    const consumed = Math.floor(this.nextSourcePosition);
    if (consumed > 0) {
      this.sourceBuffer.splice(0, consumed);
      this.nextSourcePosition -= consumed;
    }

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

  private canInterpolate(position: number): boolean {
    if (position >= this.sourceBuffer.length) return false;
    return (
      Number.isInteger(position) || position + 1 < this.sourceBuffer.length
    );
  }
}
