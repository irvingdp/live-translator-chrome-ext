import { describe, expect, it } from 'vitest';

import { WebmOpusDemuxer } from '../../src/read-ahead/webm-opus-demuxer';

function idBytes(id: number): number[] {
  const bytes: number[] = [];
  for (let value = id; value > 0; value = Math.floor(value / 256)) {
    bytes.unshift(value & 0xff);
  }
  return bytes;
}

// 8-byte size vint, as muxers commonly write for masters.
function size(length: number): number[] {
  const bytes = [0x01];
  for (let shift = 6; shift >= 0; shift -= 1) {
    bytes.push(Math.floor(length / 256 ** shift) & 0xff);
  }
  return bytes;
}

function element(id: number, body: number[]): number[] {
  return [...idBytes(id), ...size(body.length), ...body];
}

function uint(value: number, length = 4): number[] {
  const bytes: number[] = [];
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes.push(Math.floor(value / 256 ** index) & 0xff);
  }
  return bytes;
}

function simpleBlock(relativeMs: number, payload: number[], flags = 0x80) {
  return element(0xa3, [0x81, (relativeMs >> 8) & 0xff, relativeMs & 0xff, flags, ...payload]);
}

const opusHead = [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 2];

function initSegment(): number[] {
  return [
    ...element(0x1a45dfa3, [0x42, 0x86, 0x81, 0x01]),
    // Segment with unknown size, as live-style WebM streams use.
    ...idBytes(0x18538067), 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ...element(0x1549a966, element(0x2ad7b1, uint(1_000_000))),
    ...element(0x1654ae6b, element(0xae, [
      ...element(0xd7, [0x01]),
      ...element(0x63a2, opusHead),
    ])),
  ];
}

function cluster(timecodeMs: number, blocks: number[][]): number[] {
  return element(0x1f43b675, [
    ...element(0xe7, uint(timecodeMs)),
    ...blocks.flat(),
  ]);
}

function splitEvery(bytes: number[], step: number): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let index = 0; index < bytes.length; index += step) {
    parts.push(Uint8Array.from(bytes.slice(index, index + step)));
  }
  return parts;
}

describe('WebmOpusDemuxer', () => {
  it('returns each Opus frame with Cluster timecode plus block offset, in seconds', () => {
    const demuxer = new WebmOpusDemuxer();
    const frames = demuxer.push(Uint8Array.from([
      ...initSegment(),
      ...cluster(10_000, [simpleBlock(0, [1, 2]), simpleBlock(20, [3])]),
    ]));

    expect(frames.map((frame) => frame.timestamp)).toEqual([10, 10.02]);
    expect(frames.map((frame) => [...frame.data])).toEqual([[1, 2], [3]]);
    expect([...demuxer.codecPrivate!]).toEqual(opusHead);
  });

  it('produces the same frames when appends split elements at arbitrary bytes', () => {
    const stream = [
      ...initSegment(),
      ...cluster(0, [simpleBlock(0, [9, 9, 9]), simpleBlock(20, [8])]),
      ...cluster(40, [simpleBlock(0, [7]), simpleBlock(-20, [6])]),
    ];
    for (const step of [1, 3, 7, 50]) {
      const demuxer = new WebmOpusDemuxer();
      const frames = splitEvery(stream, step).flatMap((part) => demuxer.push(part));
      expect(frames.map((frame) => frame.timestamp)).toEqual([0, 0.02, 0.04, 0.02]);
    }
  });

  it('drops a half-received element when the next append starts a new Cluster (seek)', () => {
    const demuxer = new WebmOpusDemuxer();
    demuxer.push(Uint8Array.from(initSegment()));
    const interrupted = cluster(0, [simpleBlock(0, [1, 1, 1, 1])]);
    demuxer.push(Uint8Array.from(interrupted.slice(0, interrupted.length - 2)));

    const frames = demuxer.push(Uint8Array.from(cluster(200_000, [simpleBlock(0, [5])])));

    expect(frames).toEqual([{ data: Uint8Array.from([5]), timestamp: 200 }]);
  });

  it('honours a non-default TimecodeScale', () => {
    const demuxer = new WebmOpusDemuxer();
    const header = initSegment();
    // Swap the 1 ms scale for 0.5 ms.
    const scaled = header.join(',').replace(uint(1_000_000).join(','), uint(500_000).join(',')).split(',').map(Number);
    const frames = demuxer.push(Uint8Array.from([...scaled, ...cluster(4000, [simpleBlock(10, [1])])]));
    expect(frames[0]!.timestamp).toBeCloseTo(2.005, 6);
  });

  it('skips laced blocks rather than mis-timing the frames inside them', () => {
    const demuxer = new WebmOpusDemuxer();
    const frames = demuxer.push(Uint8Array.from([
      ...initSegment(),
      ...cluster(0, [simpleBlock(0, [1, 2, 3], 0x82), simpleBlock(20, [4])]),
    ]));
    expect(frames.map((frame) => frame.timestamp)).toEqual([0.02]);
    expect(demuxer.lacedBlocksDropped).toBe(1);
  });

  it('reset discards buffered bytes so a fresh stream parses cleanly', () => {
    const demuxer = new WebmOpusDemuxer();
    demuxer.push(Uint8Array.from(initSegment().slice(0, 5)));
    demuxer.reset();
    const frames = demuxer.push(Uint8Array.from([
      ...initSegment(),
      ...cluster(1000, [simpleBlock(0, [1])]),
    ]));
    expect(frames.map((frame) => frame.timestamp)).toEqual([1]);
  });
});
