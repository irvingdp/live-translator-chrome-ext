// Builds ISO BMFF boxes for tests: the shapes MediaSource players append.
const u32 = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const u16 = (value: number) => [(value >>> 8) & 255, value & 255];
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

export function box(type: string, ...parts: Array<number[] | Uint8Array>): number[] {
  const body = parts.flatMap((part) => [...part]);
  return [...u32(8 + body.length), ...ascii(type), ...body];
}

const full = (type: string, version: number, flags: number, ...parts: number[][]) =>
  box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);

// An init segment with a video track and an audio track: AAC with the given
// AudioSpecificConfig (AAC-LC 48 kHz stereo by default), or `entry` instead
// of 'mp4a' (an encrypted 'enca', an unknown codec).
export function aacInit(options: { asc?: number[]; entry?: string; trackId?: number } = {}): Uint8Array {
  const { asc = [0x11, 0x90], entry = 'mp4a', trackId = 2 } = options;
  const esds = full('esds', 0, 0, [
    0x03, 0x19, ...u16(trackId), 0x00,
    0x04, 0x11, 0x40, 0x15, 0, 0, 0, ...u32(0), ...u32(0),
    0x05, asc.length, ...asc,
    0x06, 0x01, 0x02,
  ]);
  const sampleEntry = box(entry, [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, ...u16(2), ...u16(16), 0, 0, 0, 0, ...u32(48_000 << 16)], esds);
  const audio = box('trak',
    full('tkhd', 0, 3, u32(0), u32(0), u32(trackId)),
    box('mdia',
      full('mdhd', 0, 0, u32(0), u32(0), u32(48_000), u32(0), [0, 0, 0, 0]),
      full('hdlr', 0, 0, u32(0), ascii('soun'), u32(0), u32(0), u32(0), [0]),
      box('minf', box('stbl', full('stsd', 0, 0, u32(1), sampleEntry)))));
  const video = box('trak', full('tkhd', 0, 3, u32(0), u32(0), u32(1)), box('mdia',
    full('hdlr', 0, 0, u32(0), ascii('vide'), u32(0), u32(0), u32(0), [0])));
  return new Uint8Array([...box('ftyp', ascii('iso6')), ...box('moov', video, audio)]);
}

// One moof + mdat for `trackId` starting at `start` ticks: frames of `sizes`
// bytes, `duration` ticks each, filled with 1, 2, 3, …
export function fragment(trackId: number, start: number, sizes: number[], duration = 1024): Uint8Array {
  const trun = (dataOffset: number) => full('trun', 0, 0x1 | 0x100 | 0x200,
    u32(sizes.length), u32(dataOffset), ...sizes.flatMap((size) => [u32(duration), u32(size)]));
  const traf = (dataOffset: number) => box('traf',
    full('tfhd', 0, 0x20000, u32(trackId)),
    full('tfdt', 1, 0, [...u32(Math.floor(start / 2 ** 32)), ...u32(start >>> 0)]),
    trun(dataOffset));
  const moofLength = box('moof', traf(0)).length;
  const payload = sizes.flatMap((size, index) => Array.from({ length: size }, () => index + 1));
  return new Uint8Array([...box('moof', traf(moofLength + 8)), ...box('mdat', payload)]);
}
