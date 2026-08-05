import { describe, expect, it } from 'vitest';

import { Pcm16Chunker } from '../../src/audio/pcm16-chunker';

function int16Values(buffer: ArrayBuffer): number[] {
  return Array.from(new Int16Array(buffer));
}

describe('Pcm16Chunker', () => {
  it('resamples 48 kHz audio into 40 ms chunks at 16 kHz', () => {
    const chunker = new Pcm16Chunker(48_000, 16_000, 40);
    const source = new Float32Array(3_840).fill(0.5);

    const chunks = chunker.push(source);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.byteLength).toBe(1_280);
    expect(chunks[1]?.byteLength).toBe(1_280);
    expect(int16Values(chunks[0]!)[0]).toBe(16_384);
  });

  it('preserves chunk boundaries across separate WebAudio callbacks', () => {
    const chunker = new Pcm16Chunker(16_000, 16_000, 40);

    expect(chunker.push(new Float32Array(320).fill(0.25))).toHaveLength(0);
    const chunks = chunker.push(new Float32Array(320).fill(0.25));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.byteLength).toBe(1_280);
  });

  it('clamps floating point samples before converting to signed PCM16', () => {
    const chunker = new Pcm16Chunker(16_000, 16_000, 1);

    const [chunk] = chunker.push(
      Float32Array.from([
        -2, -1, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ]),
    );

    expect(int16Values(chunk!)).toEqual([
      -32_768, -32_768, 0, 32_767, 32_767, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0,
    ]);
  });

  it('flushes a final partial chunk without zero padding', () => {
    const chunker = new Pcm16Chunker(16_000, 16_000, 40);
    chunker.push(new Float32Array(160).fill(0.5));

    const chunk = chunker.flush();

    expect(chunk?.byteLength).toBe(320);
    expect(chunker.flush()).toBeUndefined();
  });

  it('produces identical 44.1 kHz output across arbitrary callback splits', () => {
    const source = Float32Array.from(
      { length: 44_100 },
      (_, index) => Math.sin(index / 20),
    );
    const whole = new Pcm16Chunker(44_100);
    const split = new Pcm16Chunker(44_100);

    const wholeOutput = whole.push(source);
    const wholeTail = whole.flush();
    if (wholeTail) wholeOutput.push(wholeTail);
    const splitOutput = [
      ...split.push(source.slice(0, 137)),
      ...split.push(source.slice(137, 2_048)),
      ...split.push(source.slice(2_048)),
    ];
    const splitTail = split.flush();
    if (splitTail) splitOutput.push(splitTail);

    const flatten = (buffers: ArrayBuffer[]) =>
      buffers.flatMap((buffer) => Array.from(new Int16Array(buffer)));
    expect(flatten(splitOutput)).toEqual(flatten(wholeOutput));
    expect(flatten(splitOutput)).toHaveLength(16_000);
  });
});
