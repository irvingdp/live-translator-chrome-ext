// Fragmented MP4 audio, as MediaSource players append it (ADR 0009): the init
// segment says what the audio is (codec setup, sample rate, channels,
// timescale); each fragment carries timed frames. This reads just enough of
// ISO BMFF for read-ahead to decode the audio with WebCodecs: the audio track,
// AAC (any profile) or Opus, fragments with tfdt + trun.

export interface Fmp4AudioTrack {
  channels: number;
  // WebCodecs codec string ('mp4a.40.2', 'mp4a.40.5', 'opus').
  codec: string;
  // AudioDecoderConfig.description: AAC's AudioSpecificConfig, or an OpusHead
  // built from dOps.
  description?: Uint8Array;
  sampleRate: number;
  timescale: number;
  trackId: number;
}

export interface Fmp4AudioFrame {
  data: Uint8Array;
  // Media time in seconds.
  timestamp: number;
}

// What an init segment holds for read-ahead: an audio track it can decode, an
// encrypted one (DRM), or neither (video only, or an unknown codec).
export type Fmp4InitAudio =
  | { kind: 'audio'; track: Fmp4AudioTrack }
  | { kind: 'encrypted' }
  | { kind: 'none'; codec?: string };

interface Box {
  body: number;
  end: number;
  start: number;
  type: string;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function boxes(bytes: Uint8Array, start = 0, end = bytes.length): Box[] {
  const data = view(bytes);
  const found: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = data.getUint32(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = Number(data.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) break;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    found.push({ body: offset + header, end: offset + size, start: offset, type });
    offset += size;
  }
  return found;
}

function child(bytes: Uint8Array, parent: Box | undefined, type: string): Box | undefined {
  return parent && boxes(bytes, parent.body, parent.end).find((box) => box.type === type);
}

function path(bytes: Uint8Array, parent: Box | undefined, types: string[]): Box | undefined {
  let current = parent;
  for (const type of types) current = child(bytes, current, type);
  return current;
}

// An MPEG-4 descriptor's length: up to four bytes of 7 bits each.
function descriptorLength(bytes: Uint8Array, offset: number): [length: number, next: number] {
  let length = 0;
  let index = offset;
  for (let count = 0; count < 4; count += 1) {
    const byte = bytes[index++]!;
    length = (length << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return [length, index];
}

// The DecoderSpecificInfo (tag 5) inside an esds: AAC's AudioSpecificConfig.
function audioSpecificConfig(bytes: Uint8Array, esds: Box): Uint8Array | undefined {
  for (let index = esds.body + 4; index < esds.end - 1; index += 1) {
    if (bytes[index] !== 0x05) continue;
    const [length, start] = descriptorLength(bytes, index + 1);
    if (length > 0 && start + length <= esds.end) return bytes.slice(start, start + length);
  }
  return undefined;
}

// OpusHead (RFC 7845) from an MP4 dOps box.
function opusHead(bytes: Uint8Array, dops: Box, channels: number): Uint8Array {
  const data = view(bytes);
  const head = new Uint8Array(19);
  const out = new DataView(head.buffer);
  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1]);
  head[9] = bytes[dops.body + 1] ?? channels;
  out.setUint16(10, data.getUint16(dops.body + 2), true);
  out.setUint32(12, data.getUint32(dops.body + 4), true);
  out.setInt16(16, data.getInt16(dops.body + 8), true);
  return head;
}

const SAMPLING_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

class BitReader {
  private position = 0;
  constructor(private readonly bytes: Uint8Array) {}
  read(count: number): number {
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      const byte = this.bytes[this.position >> 3] ?? 0;
      value = value * 2 + ((byte >> (7 - (this.position & 7))) & 1);
      this.position += 1;
    }
    return value;
  }
}

function writeBits(fields: Array<[value: number, bits: number]>): Uint8Array {
  const total = fields.reduce((sum, [, bits]) => sum + bits, 0);
  const bytes = new Uint8Array(Math.ceil(total / 8));
  let position = 0;
  for (const [value, bits] of fields) {
    for (let index = bits - 1; index >= 0; index -= 1) {
      if (Math.floor(value / 2 ** index) % 2) bytes[position >> 3]! |= 1 << (7 - (position & 7));
      position += 1;
    }
  }
  return bytes;
}

interface AacConfig {
  channels: number;
  description: Uint8Array;
  objectType: number;
  sampleRate?: number;
}

// AAC's AudioSpecificConfig, with HE-AAC (SBR, object type 5) and HE-AAC v2
// (PS, 29) reduced to their AAC core: the core alone carries everything up to
// half its sampling rate, more than read-ahead's 16 kHz needs. It also makes
// a stream a player mislabels as HE-AAC decode: hls.js writes an SBR config
// over plain 48 kHz AAC-LC when the playlist says mp4a.40.5 (seen on one site), and
// decoding that as HE-AAC breaks every frame join (ADR 0009).
function aacConfig(asc: Uint8Array): AacConfig {
  const reader = new BitReader(asc);
  const objectTypeOf = () => {
    const type = reader.read(5);
    return type === 31 ? 32 + reader.read(6) : type;
  };
  const rateOf = (): [index: number, rate?: number] => {
    const index = reader.read(4);
    return index === 15 ? [15, reader.read(24)] : [index, SAMPLING_RATES[index]];
  };
  let objectType = objectTypeOf();
  const [rateIndex, sampleRate] = rateOf();
  const channelConfig = reader.read(4);
  if (objectType !== 5 && objectType !== 29) {
    return { channels: channelConfig, description: asc, objectType, ...(sampleRate ? { sampleRate } : {}) };
  }
  // The extension's sampling rate, then the core's object type. (With
  // parametric stereo the channel configuration already says mono.)
  rateOf();
  objectType = objectTypeOf();
  const fields: Array<[number, number]> = objectType >= 32
    ? [[31, 5], [objectType - 32, 6]]
    : [[objectType, 5]];
  fields.push([rateIndex, 4]);
  if (rateIndex === 15) fields.push([sampleRate ?? 0, 24]);
  // GASpecificConfig: frame length 1024, no core coder delay, no extension.
  fields.push([channelConfig, 4], [0, 3]);
  return {
    channels: channelConfig,
    description: writeBits(fields),
    objectType,
    ...(sampleRate ? { sampleRate } : {}),
  };
}

export function isInitSegment(bytes: Uint8Array): boolean {
  return boxes(bytes).some((box) => box.type === 'moov');
}

export function parseInitSegment(bytes: Uint8Array): Fmp4InitAudio {
  const moov = boxes(bytes).find((box) => box.type === 'moov');
  if (!moov) return { kind: 'none' };
  const data = view(bytes);
  let encrypted = false;
  let unknown: string | undefined;
  for (const trak of boxes(bytes, moov.body, moov.end).filter((box) => box.type === 'trak')) {
    const mdia = child(bytes, trak, 'mdia');
    const stsd = path(bytes, mdia, ['minf', 'stbl', 'stsd']);
    const entry = stsd && boxes(bytes, stsd.body + 8, stsd.end)[0];
    // Encrypted media (CENC) marks its sample entries: DRM, never decodable.
    if (entry?.type === 'enca' || entry?.type === 'encv') encrypted = true;
    const hdlr = child(bytes, mdia, 'hdlr');
    if (!hdlr || String.fromCharCode(...bytes.subarray(hdlr.body + 8, hdlr.body + 12)) !== 'soun') continue;
    const tkhd = child(bytes, trak, 'tkhd');
    const mdhd = child(bytes, mdia, 'mdhd');
    if (!tkhd || !mdhd || !entry) continue;
    const trackId = data.getUint32(tkhd.body + (bytes[tkhd.body] === 1 ? 20 : 12));
    const timescale = data.getUint32(mdhd.body + (bytes[mdhd.body] === 1 ? 20 : 12));
    // An AudioSampleEntry: 6 reserved, 2 data reference index, 8 reserved,
    // channels, sample size, 4 reserved, then a 16.16 sample rate.
    const channels = data.getUint16(entry.body + 16);
    const sampleRate = data.getUint32(entry.body + 24) >>> 16;
    const inner = boxes(bytes, entry.body + 28, entry.end);
    if (entry.type === 'mp4a') {
      const esds = inner.find((box) => box.type === 'esds');
      const asc = esds && audioSpecificConfig(bytes, esds);
      if (!asc) continue;
      const config = aacConfig(asc);
      return {
        kind: 'audio',
        track: {
          channels: config.channels || channels,
          codec: `mp4a.40.${config.objectType}`,
          description: config.description,
          sampleRate: config.sampleRate ?? sampleRate,
          timescale,
          trackId,
        },
      };
    }
    if (entry.type === 'Opus') {
      const dops = inner.find((box) => box.type === 'dOps');
      return {
        kind: 'audio',
        track: {
          channels,
          codec: 'opus',
          ...(dops ? { description: opusHead(bytes, dops, channels) } : {}),
          sampleRate: 48_000,
          timescale,
          trackId,
        },
      };
    }
    unknown = entry.type;
  }
  if (encrypted) return { kind: 'encrypted' };
  return unknown ? { codec: unknown, kind: 'none' } : { kind: 'none' };
}

// The track's frames in one append: any number of moof + mdat pairs. Other
// tracks (video in a muxed buffer) are skipped.
export function parseFragments(bytes: Uint8Array, track: Fmp4AudioTrack): Fmp4AudioFrame[] {
  const data = view(bytes);
  const frames: Fmp4AudioFrame[] = [];
  for (const moof of boxes(bytes).filter((box) => box.type === 'moof')) {
    for (const traf of boxes(bytes, moof.body, moof.end).filter((box) => box.type === 'traf')) {
      const tfhd = child(bytes, traf, 'tfhd');
      if (!tfhd || data.getUint32(tfhd.body + 4) !== track.trackId) continue;
      const tfhdFlags = data.getUint32(tfhd.body) & 0xffffff;
      let offset = tfhd.body + 8;
      // Data offsets count from the moof (default-base-is-moof, as MSE players
      // write it); an explicit base offset is a file position this append
      // cannot map, so it is skipped.
      if (tfhdFlags & 0x1) offset += 8;
      if (tfhdFlags & 0x2) offset += 4;
      const defaultDuration = tfhdFlags & 0x8 ? data.getUint32(offset) : 0;
      if (tfhdFlags & 0x8) offset += 4;
      const defaultSize = tfhdFlags & 0x10 ? data.getUint32(offset) : 0;

      const tfdt = child(bytes, traf, 'tfdt');
      let time = tfdt
        ? bytes[tfdt.body] === 1 ? Number(data.getBigUint64(tfdt.body + 4)) : data.getUint32(tfdt.body + 4)
        : 0;
      for (const trun of boxes(bytes, traf.body, traf.end).filter((box) => box.type === 'trun')) {
        const flags = data.getUint32(trun.body) & 0xffffff;
        const count = data.getUint32(trun.body + 4);
        let cursor = trun.body + 8;
        let position = moof.start;
        if (flags & 0x1) {
          position = moof.start + data.getInt32(cursor);
          cursor += 4;
        }
        if (flags & 0x4) cursor += 4;
        for (let index = 0; index < count; index += 1) {
          let duration = defaultDuration;
          let size = defaultSize;
          if (flags & 0x100) { duration = data.getUint32(cursor); cursor += 4; }
          if (flags & 0x200) { size = data.getUint32(cursor); cursor += 4; }
          if (flags & 0x400) cursor += 4;
          if (flags & 0x800) cursor += 4;
          if (size === 0 || position + size > bytes.length) break;
          frames.push({ data: bytes.slice(position, position + size), timestamp: time / track.timescale });
          position += size;
          time += duration;
        }
      }
    }
  }
  return frames;
}
