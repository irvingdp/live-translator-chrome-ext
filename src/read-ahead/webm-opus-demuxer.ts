// Turns the bytes YouTube appends to an audio SourceBuffer back into Opus
// frames that carry their media timestamps. YouTube's appends do not line up
// with WebM Clusters (a ~10 s Cluster arrives split over many appends), so
// this is a streaming parser that keeps whatever element is still incomplete
// and finishes it on the next push. See docs/adr/0001.

export interface OpusFrame {
  data: Uint8Array;
  // Media time in seconds: Cluster timecode plus the block's relative offset.
  timestamp: number;
}

const EBML_HEADER = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const CLUSTER = 0x1f43b675;
const INFO = 0x1549a966;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const BLOCK_GROUP = 0xa0;
const TIMECODE = 0xe7;
const TIMECODE_SCALE = 0x2ad7b1;
const CODEC_PRIVATE = 0x63a2;
const SIMPLE_BLOCK = 0xa3;
const BLOCK = 0xa1;

// Masters are entered (header consumed, body parsed as children) rather than
// skipped, because their children are what we need. Every other element is
// either read or skipped whole.
const MASTERS = new Set([SEGMENT, INFO, CLUSTER, TRACKS, TRACK_ENTRY, BLOCK_GROUP]);

function idLength(first: number): number {
  if (first & 0x80) return 1;
  if (first & 0x40) return 2;
  if (first & 0x20) return 3;
  if (first & 0x10) return 4;
  return 0;
}

function sizeLength(first: number): number {
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) {
    length += 1;
    mask >>= 1;
  }
  return length;
}

function readUint(bytes: Uint8Array): number {
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  return value;
}

function startsWith(bytes: Uint8Array, id: number): boolean {
  return bytes.length >= 4 &&
    bytes[0] === (id >>> 24 & 0xff) &&
    bytes[1] === (id >>> 16 & 0xff) &&
    bytes[2] === (id >>> 8 & 0xff) &&
    bytes[3] === (id & 0xff);
}

export class WebmOpusDemuxer {
  codecPrivate?: Uint8Array;
  // Laced blocks pack several frames without per-frame timestamps. Opus in
  // WebM does not use lacing in practice; they are counted and dropped.
  lacedBlocksDropped = 0;
  private pending = new Uint8Array(0);
  private clusterTimecode = 0;
  private timecodeScale = 1_000_000;

  reset(): void {
    this.pending = new Uint8Array(0);
  }

  push(chunk: Uint8Array): OpusFrame[] {
    // An append that opens a new stream or a new Cluster means YouTube
    // restarted (a seek or an abort); a half-parsed element from before can
    // never be completed.
    if (startsWith(chunk, EBML_HEADER) || startsWith(chunk, CLUSTER)) {
      this.reset();
    }
    const buffer = new Uint8Array(this.pending.length + chunk.length);
    buffer.set(this.pending);
    buffer.set(chunk, this.pending.length);

    const frames: OpusFrame[] = [];
    let offset = 0;
    while (offset < buffer.length) {
      const idBytes = idLength(buffer[offset]!);
      if (idBytes === 0) {
        // Not an element boundary: the stream is corrupt from here on.
        offset = buffer.length;
        break;
      }
      if (offset + idBytes >= buffer.length) break;
      const id = readUint(buffer.subarray(offset, offset + idBytes));
      const sizeStart = offset + idBytes;
      const sizeBytes = sizeLength(buffer[sizeStart]!);
      if (sizeStart + sizeBytes > buffer.length) break;
      let size = buffer[sizeStart]! & (0xff >> sizeBytes);
      let unknownSize = size === (0xff >> sizeBytes);
      for (let index = 1; index < sizeBytes; index += 1) {
        const byte = buffer[sizeStart + index]!;
        size = size * 256 + byte;
        if (byte !== 0xff) unknownSize = false;
      }
      const bodyStart = sizeStart + sizeBytes;
      if (MASTERS.has(id)) {
        offset = bodyStart;
        continue;
      }
      if (unknownSize || bodyStart + size > buffer.length) break;
      const body = buffer.subarray(bodyStart, bodyStart + size);
      this.readLeaf(id, body, frames);
      offset = bodyStart + size;
    }
    this.pending = buffer.slice(offset);
    return frames;
  }

  private readLeaf(id: number, body: Uint8Array, frames: OpusFrame[]): void {
    switch (id) {
      case TIMECODE_SCALE:
        this.timecodeScale = readUint(body);
        return;
      case TIMECODE:
        this.clusterTimecode = readUint(body);
        return;
      case CODEC_PRIVATE:
        this.codecPrivate = body.slice();
        return;
      case SIMPLE_BLOCK:
      case BLOCK: {
        const trackBytes = sizeLength(body[0]!);
        if (body.length < trackBytes + 3) return;
        const relative =
          ((body[trackBytes]! << 8) | body[trackBytes + 1]!) << 16 >> 16;
        const flags = body[trackBytes + 2]!;
        if (flags & 0x06) {
          this.lacedBlocksDropped += 1;
          return;
        }
        frames.push({
          data: body.slice(trackBytes + 3),
          timestamp:
            (this.clusterTimecode + relative) * this.timecodeScale / 1e9,
        });
        return;
      }
    }
  }
}
