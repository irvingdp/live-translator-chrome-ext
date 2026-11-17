// Buffer tap (GLOSSARY.md): runs in YouTube's own page world, because that is
// the only place its MediaSource is visible. It reads the Opus audio the main
// player has already downloaded but not yet played, decodes it with WebCodecs
// and posts 16 kHz mono blocks, stamped with media time, to the isolated-world
// read-ahead script. It also keeps the Opus frames for as long as YouTube
// keeps that audio buffered, so a seek back into YouTube's buffer can be read
// again without reloading the player. See docs/adr/0001.
import { OpusFrameStore } from './opus-frame-store';
import { WebmOpusDemuxer, type OpusFrame } from './webm-opus-demuxer';

export const TAP_MESSAGE_SOURCE = 'bilingual-read-ahead-tap';

export type TapToContentMessage = {
  samples: Float32Array;
  source: typeof TAP_MESSAGE_SOURCE;
  start: number;
  type: 'audio';
};

export type ContentToTapMessage =
  | { enabled: boolean; source: typeof TAP_MESSAGE_SOURCE; type: 'enable' }
  // Send the stored audio from `time` again (the session dropped it).
  | { source: typeof TAP_MESSAGE_SOURCE; time: number; type: 'seek' }
  // A hold is getting no audio: send it from the store, or reload the player.
  | { source: typeof TAP_MESSAGE_SOURCE; time: number; type: 'refill' };

const INSTALL_KEY = '__bilingualReadAheadTapInstalled';
const OPUS_RATE = 48_000;
const OUTPUT_RATE = 16_000;
const DECIMATION = OPUS_RATE / OUTPUT_RATE;
const FLUSH_MS = 200;
const MAX_BLOCK_SECONDS = 2;
const CONTIGUITY_SECONDS = 0.03;
// How much stored audio one seek or refill sends: the session reads ahead at
// most 30 s plus one chunk.
const REPLAY_SECONDS = 60;
// A replay may start this far after the requested time (the stored audio
// after a seek begins where YouTube's fetch began).
const REPLAY_LOOKAHEAD_SECONDS = 6;
const SEEK_LOOKBACK_SECONDS = 5;
// A refill or a start only counts as served when the stored audio reaches
// this far past the viewer; otherwise the player is reloaded.
const VIEWER_COVER_SECONDS = 1;
// A reload that has not helped yet is not repeated sooner than this.
const RELOAD_INTERVAL_MS = 10_000;

type TapWindow = Window & { [INSTALL_KEY]?: boolean };

interface TappedBuffer {
  ad: boolean;
  buffer: SourceBuffer;
  dead: boolean;
  decoder?: AudioDecoder;
  demuxer: WebmOpusDemuxer;
  lastFrameTimestamp?: number;
  store: OpusFrameStore;
}

// Chrome's AudioDecoder stamps its output by counting samples from the first
// input, not from each input's timestamp, so after a seek its output would
// carry the wrong media time. A jump in input timestamps therefore gets a
// fresh decoder, whose first output is stamped from its first input.
const MAX_FRAME_GAP_SECONDS = 0.1;

function adShowing(document: Document): boolean {
  return Boolean(document.querySelector('#movie_player')?.classList.contains('ad-showing'));
}

// 48 kHz → 16 kHz by averaging each group of three, mixing channels to mono.
// Speech recognition does not need a better anti-alias filter than that.
function toMono16k(data: AudioData): Float32Array {
  const frames = data.numberOfFrames;
  const channels = data.numberOfChannels;
  const mixed = new Float32Array(frames);
  const plane = new Float32Array(frames);
  for (let channel = 0; channel < channels; channel += 1) {
    data.copyTo(plane, { format: 'f32-planar', planeIndex: channel });
    for (let index = 0; index < frames; index += 1) mixed[index]! += plane[index]! / channels;
  }
  const ratio = Math.round(data.sampleRate / OUTPUT_RATE) || DECIMATION;
  const output = new Float32Array(Math.floor(frames / ratio));
  for (let index = 0; index < output.length; index += 1) {
    let sum = 0;
    for (let offset = 0; offset < ratio; offset += 1) sum += mixed[index * ratio + offset]!;
    output[index] = sum / ratio;
  }
  return output;
}

export function installBufferTap(view: Window): void {
  const tapWindow = view as TapWindow;
  if (tapWindow[INSTALL_KEY]) return;
  tapWindow[INSTALL_KEY] = true;
  const { document } = view;

  let enabled = false;
  const adSources = new WeakSet<MediaSource>();
  // Newest first: after a video change the old buffers are dead weight.
  const tappedBuffers: TappedBuffer[] = [];
  let pending: { parts: Float32Array[]; start: number; end: number } | undefined;
  let flushTimer: number | undefined;

  const flush = () => {
    if (flushTimer !== undefined) view.clearTimeout(flushTimer);
    flushTimer = undefined;
    if (!pending) return;
    const length = pending.parts.reduce((sum, part) => sum + part.length, 0);
    const samples = new Float32Array(length);
    let offset = 0;
    for (const part of pending.parts) {
      samples.set(part, offset);
      offset += part.length;
    }
    const message: TapToContentMessage = {
      samples,
      source: TAP_MESSAGE_SOURCE,
      start: pending.start,
      type: 'audio',
    };
    pending = undefined;
    view.postMessage(message, view.location.origin, [samples.buffer]);
  };

  const emit = (start: number, samples: Float32Array) => {
    if (!enabled || samples.length === 0) return;
    const end = start + samples.length / OUTPUT_RATE;
    if (pending && (Math.abs(pending.end - start) > CONTIGUITY_SECONDS ||
      pending.end - pending.start > MAX_BLOCK_SECONDS)) flush();
    if (pending) {
      pending.parts.push(samples);
      pending.end = end;
    } else {
      pending = { end, parts: [samples], start };
    }
    if (flushTimer === undefined) flushTimer = view.setTimeout(flush, FLUSH_MS);
  };

  const createDecoder = (head: Uint8Array | undefined, onError: () => void) => {
    const decoder = new AudioDecoder({
      error: onError,
      output: (data) => {
        try {
          emit(data.timestamp / 1e6, toMono16k(data));
        } finally {
          data.close();
        }
      },
    });
    decoder.configure({
      codec: 'opus',
      numberOfChannels: head && head.length > 9 ? head[9]! : 2,
      sampleRate: OPUS_RATE,
      ...(head ? { description: head } : {}),
    });
    return decoder;
  };

  const decode = (decoder: AudioDecoder, frame: OpusFrame) => {
    decoder.decode(new EncodedAudioChunk({
      data: frame.data,
      timestamp: Math.round(frame.timestamp * 1e6),
      type: 'key',
    }));
  };

  const decoderFor = (tapped: TappedBuffer): AudioDecoder | undefined => {
    if (tapped.decoder && tapped.decoder.state !== 'closed') return tapped.decoder;
    if (typeof AudioDecoder === 'undefined') return undefined;
    tapped.decoder = createDecoder(tapped.demuxer.codecPrivate, () => {
      tapped.decoder = undefined;
    });
    return tapped.decoder;
  };

  // Mirrors the SourceBuffer: what YouTube (or Chrome's quota eviction) has
  // removed it will append again when needed, so the frames can go.
  const syncStore = (tapped: TappedBuffer) => {
    try {
      // YouTube often starts the next append between a SourceBuffer's
      // `update` and `updateend` events. That append's frames are already
      // stored but not yet in `buffered`, so pruning now would drop them;
      // its own updateend prunes instead.
      if (tapped.buffer.updating) return;
      const { buffered } = tapped.buffer;
      const ranges: Array<[number, number]> = [];
      for (let index = 0; index < buffered.length; index += 1) {
        ranges.push([buffered.start(index), buffered.end(index)]);
      }
      tapped.store.retain(ranges);
    } catch {
      // Removed from its MediaSource (a new video): nothing to read back.
      tapped.dead = true;
      tapped.store.clear();
    }
  };

  // Sends stored audio from `from` again, with its own decoder so the output
  // carries the right timestamps. False (and nothing sent) when nothing
  // stored covers it, or the stored run stops before `reach`.
  const replay = (from: number, reach = -Infinity): boolean => {
    if (!enabled || typeof AudioDecoder === 'undefined') return false;
    for (const tapped of tappedBuffers) {
      if (tapped.dead || tapped.ad) continue;
      syncStore(tapped);
      const frames = tapped.store.run(from, from + REPLAY_SECONDS, REPLAY_LOOKAHEAD_SECONDS);
      if (frames.length === 0 || frames.at(-1)!.timestamp < reach) continue;
      const decoder = createDecoder(tapped.demuxer.codecPrivate, () => undefined);
      for (const frame of frames) decode(decoder, frame);
      void decoder.flush().then(() => decoder.close(), () => undefined);
      return true;
    }
    return false;
  };

  // Lets the old decoder finish what it was given before it goes.
  const retireDecoder = (tapped: TappedBuffer) => {
    const old = tapped.decoder;
    tapped.decoder = undefined;
    if (!old || old.state === 'closed') return;
    void old.flush().then(
      () => old.state !== 'closed' && old.close(),
      () => undefined,
    );
  };

  const tapAppend = (tapped: TappedBuffer, data: BufferSource, source?: MediaSource) => {
    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (adShowing(document)) {
      tapped.ad = true;
      if (source) adSources.add(source);
    }
    // Parse and store even while disabled, so the demuxer stays in step with
    // the stream and a later session can read back what is already buffered;
    // just do not decode what nobody will use.
    const frames = tapped.demuxer.push(bytes);
    if (tapped.ad || frames.length === 0) return;
    tapped.store.add(frames);
    if (!enabled) return;
    for (const frame of frames) {
      const previous = tapped.lastFrameTimestamp;
      tapped.lastFrameTimestamp = frame.timestamp;
      if (previous !== undefined && tapped.decoder &&
        (frame.timestamp < previous || frame.timestamp - previous > MAX_FRAME_GAP_SECONDS)) {
        retireDecoder(tapped);
      }
      const decoder = decoderFor(tapped);
      if (!decoder) return;
      decode(decoder, frame);
    }
  };

  const originalAdd = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (this: MediaSource, mime: string) {
    const buffer = originalAdd.call(this, mime);
    if (!/^audio\/webm/i.test(mime)) return buffer;
    const source = this;
    // An ad plays through its own MediaSource; its timestamps start at 0 and
    // would overlap the video's.
    const tapped: TappedBuffer = {
      ad: adSources.has(source) || adShowing(document),
      buffer,
      dead: false,
      demuxer: new WebmOpusDemuxer(),
      store: new OpusFrameStore(),
    };
    if (tapped.ad) adSources.add(source);
    for (const old of tappedBuffers) syncStore(old);
    tappedBuffers.unshift(tapped);
    for (let index = tappedBuffers.length - 1; index >= 0; index -= 1) {
      if (tappedBuffers[index]!.dead) tappedBuffers.splice(index, 1);
    }
    buffer.addEventListener('updateend', () => syncStore(tapped));
    const originalAppend = buffer.appendBuffer;
    const originalAbort = buffer.abort;
    buffer.appendBuffer = function (this: SourceBuffer, data: BufferSource) {
      try {
        tapAppend(tapped, data, source);
      } catch {
        // Never let the tap break playback.
      }
      return originalAppend.call(this, data);
    };
    buffer.abort = function (this: SourceBuffer) {
      tapped.demuxer.reset();
      return originalAbort.call(this);
    };
    return buffer;
  };

  // The tap is injected when read-ahead starts, after YouTube already built
  // its SourceBuffers and appended the audio ahead. Reloading the video at the
  // same position makes the player build new ones and append again, which the
  // hook above now sees.
  let lastReloadAt = -Infinity;
  const reloadPlayer = () => {
    if (Date.now() - lastReloadAt < RELOAD_INTERVAL_MS) return;
    const player = document.querySelector('#movie_player') as (HTMLElement & {
      getVideoData?: () => { video_id?: string };
      loadVideoById?: (options: { startSeconds: number; videoId: string }) => void;
    }) | null;
    const video = document.querySelector('#movie_player video') as HTMLVideoElement | null;
    const videoId = player?.getVideoData?.().video_id;
    if (!player?.loadVideoById || !videoId || !video) return;
    lastReloadAt = Date.now();
    player.loadVideoById({ startSeconds: video.currentTime, videoId });
  };

  const viewerTime = () =>
    (document.querySelector('#movie_player video') as HTMLVideoElement | null)?.currentTime ?? 0;

  view.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== view) return;
    const message = event.data as {
      enabled?: unknown;
      source?: unknown;
      time?: unknown;
      type?: unknown;
    } | null;
    if (message?.source !== TAP_MESSAGE_SOURCE) return;
    const time = typeof message.time === 'number' && Number.isFinite(message.time)
      ? message.time
      : undefined;
    if (message.type === 'seek' && time !== undefined) {
      replay(time);
      return;
    }
    if (message.type === 'refill' && time !== undefined) {
      if (enabled && !replay(Math.max(0, time - SEEK_LOOKBACK_SECONDS), time + VIEWER_COVER_SECONDS)) {
        reloadPlayer();
      }
      return;
    }
    if (message.type !== 'enable') return;
    enabled = message.enabled === true;
    if (!enabled) {
      pending = undefined;
      return;
    }
    // Audio appended before the tap was installed was never seen; only a
    // reload makes the player append it again. Once the tap has stored what
    // is buffered (a later session in the same page), that is enough.
    const viewer = viewerTime();
    if (!replay(Math.max(0, viewer - SEEK_LOOKBACK_SECONDS), viewer + VIEWER_COVER_SECONDS)) {
      reloadPlayer();
    }
  });
}
