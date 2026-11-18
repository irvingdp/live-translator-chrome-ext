// The MediaSource tap (GLOSSARY.md: Buffer tap; ADR 0009). Registered to run
// in the MAIN world of an allowed site from document_start, so it is in place
// before any player builds its MediaSource: it sees every SourceBuffer and
// every append, init segment included, whatever the player. It reads the main
// video's audio (fMP4 with AAC or Opus, WebM with Opus), keeps the compressed
// frames the player still buffers, and only once read-ahead is enabled
// decodes them with WebCodecs and posts 16 kHz mono blocks, in the same
// messages as the YouTube tap. Until then it sends nothing anywhere.
import { parseFragments, parseInitSegment, isInitSegment, type Fmp4AudioTrack } from './fmp4-audio';
import { OpusFrameStore } from './opus-frame-store';
import { MAX_FRAME_GAP_SECONDS, createAudioEmitter, planesOf, toMono16k } from './tap-audio';
import { WebmOpusDemuxer, type OpusFrame } from './webm-opus-demuxer';
import { MSE_TAP_MARKER, TAP_MESSAGE_SOURCE, type TapToContentMessage } from './youtube-buffer-tap';

const INSTALL_KEY = '__bilingualMseTapInstalled';
// How much stored audio one seek or refill sends, and how far after the
// requested time it may start (a player's fetch after a seek).
const REPLAY_SECONDS = 60;
const REPLAY_LOOKAHEAD_SECONDS = 6;
const SEEK_LOOKBACK_SECONDS = 5;
// Audio kept per buffer, whatever the player buffers: 15 minutes, most of it
// ahead of the viewer.
const MAX_STORE_SECONDS = 15 * 60;
const KEEP_BEHIND_SECONDS = 60;

// Why the main video's audio cannot be read, when it cannot.
export type MseTapUnsupported = 'codec' | 'drm' | 'no_audio';

interface AudioSetup {
  // WebCodecs config; channels and rate for Opus come from its head.
  config: AudioDecoderConfig;
}

interface TappedBuffer {
  buffer: SourceBuffer;
  container: 'mp4' | 'webm';
  dead: boolean;
  decoder?: AudioDecoder;
  demuxer?: WebmOpusDemuxer;
  // An init segment said the audio is encrypted, or in a codec not read.
  encrypted: boolean;
  lastFrameTimestamp?: number;
  setup?: AudioSetup;
  source: MediaSource;
  store: OpusFrameStore;
  track?: Fmp4AudioTrack;
  unknownCodec?: string;
}

type TapWindow = Window & { [INSTALL_KEY]?: boolean };

function containerOf(mime: string): TappedBuffer['container'] | undefined {
  if (/^(audio|video)\/mp4/i.test(mime)) return 'mp4';
  if (/^(audio|video)\/webm/i.test(mime)) return 'webm';
  return undefined;
}

// A buffer may carry audio unless its codecs say video only.
function mayCarryAudio(mime: string): boolean {
  const codecs = /codecs\s*=\s*"?([^";]*)/i.exec(mime)?.[1];
  if (!codecs) return true;
  return /mp4a|opus|vorbis|flac|ac-3|ec-3/i.test(codecs) || /^audio\//i.test(mime);
}

function opusConfig(head: Uint8Array | undefined): AudioDecoderConfig {
  return {
    codec: 'opus',
    numberOfChannels: head && head.length > 9 ? head[9]! : 2,
    sampleRate: 48_000,
    ...(head ? { description: head } : {}),
  };
}

function largestVideo(document: Document): HTMLVideoElement | undefined {
  return [...document.querySelectorAll('video')]
    .filter((video) => video.readyState > 0 || video.currentSrc)
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
}

export function installMseTap(view: Window): void {
  const tapWindow = view as TapWindow;
  if (tapWindow[INSTALL_KEY]) return;
  tapWindow[INSTALL_KEY] = true;
  const { document } = view;
  const { MediaSource, URL } = view as Window & typeof globalThis;
  // Tells read-ahead's isolated-world script the tap is here; the DOM is the
  // one thing the two worlds share.
  const mark = () => {
    if (document.documentElement) document.documentElement.dataset[MSE_TAP_MARKER] = '1';
  };
  mark();
  if (!document.documentElement) document.addEventListener('DOMContentLoaded', mark, { once: true });

  let enabled = false;
  const sources = new Map<string, MediaSource>();
  const buffers: TappedBuffer[] = [];
  const emitter = createAudioEmitter(view, (start, samples) => {
    const message: TapToContentMessage = { samples, source: TAP_MESSAGE_SOURCE, start, type: 'audio' };
    view.postMessage(message, view.location.origin, [samples.buffer]);
  });

  // The blob: URL a player hands its video names the MediaSource behind it.
  const originalCreate = URL.createObjectURL;
  URL.createObjectURL = function (this: typeof URL, object: Blob | MediaSource) {
    const url = originalCreate.call(this, object);
    if (object instanceof MediaSource) sources.set(url, object);
    return url;
  } as typeof URL.createObjectURL;

  const mainVideo = () => largestVideo(document);
  // The audio buffers of the MediaSource the main video plays; with no URL to
  // go by (srcObject), every live audio buffer.
  const mainBuffers = (): TappedBuffer[] => {
    const video = mainVideo();
    const source = video ? sources.get(video.currentSrc) : undefined;
    return buffers.filter((tapped) => !tapped.dead && (!source || tapped.source === source));
  };

  const syncStore = (tapped: TappedBuffer) => {
    try {
      if (tapped.buffer.updating) return;
      const { buffered } = tapped.buffer;
      const ranges: Array<[number, number]> = [];
      for (let index = 0; index < buffered.length; index += 1) ranges.push([buffered.start(index), buffered.end(index)]);
      tapped.store.retain(ranges);
      if (tapped.store.span() > MAX_STORE_SECONDS) {
        const viewer = mainVideo()?.currentTime ?? 0;
        tapped.store.keepWithin(viewer - KEEP_BEHIND_SECONDS, viewer - KEEP_BEHIND_SECONDS + MAX_STORE_SECONDS);
      }
    } catch {
      // Removed from its MediaSource: nothing to read back.
      tapped.dead = true;
      tapped.store.clear();
    }
  };

  const createDecoder = (setup: AudioSetup, onError: () => void): AudioDecoder => {
    const decoder = new AudioDecoder({
      error: onError,
      output: (data) => {
        try {
          if (enabled) emitter.emit(data.timestamp / 1e6, toMono16k(planesOf(data), data.sampleRate));
        } finally {
          data.close();
        }
      },
    });
    decoder.configure(setup.config);
    return decoder;
  };

  const decode = (decoder: AudioDecoder, frame: OpusFrame) => {
    decoder.decode(new EncodedAudioChunk({
      data: frame.data,
      timestamp: Math.round(frame.timestamp * 1e6),
      type: 'key',
    }));
  };

  const retireDecoder = (tapped: TappedBuffer) => {
    const old = tapped.decoder;
    tapped.decoder = undefined;
    if (!old || old.state === 'closed') return;
    void old.flush().then(() => old.state !== 'closed' && old.close(), () => undefined);
  };

  // Sends stored audio from `from` again with a fresh decoder. False (nothing
  // sent) when no stored run of the main video covers it.
  const replay = (from: number): boolean => {
    if (!enabled || typeof AudioDecoder === 'undefined') return false;
    for (const tapped of mainBuffers()) {
      if (!tapped.setup) continue;
      syncStore(tapped);
      const frames = tapped.store.run(from, from + REPLAY_SECONDS, REPLAY_LOOKAHEAD_SECONDS);
      if (frames.length === 0) continue;
      const decoder = createDecoder(tapped.setup, () => undefined);
      for (const frame of frames) decode(decoder, frame);
      void decoder.flush().then(() => decoder.close(), () => undefined);
      return true;
    }
    return false;
  };

  const readInit = (tapped: TappedBuffer, bytes: Uint8Array) => {
    if (tapped.container !== 'mp4' || !isInitSegment(bytes)) return;
    const init = parseInitSegment(bytes);
    tapped.encrypted = init.kind === 'encrypted';
    tapped.unknownCodec = init.kind === 'none' ? init.codec : undefined;
    if (init.kind !== 'audio') return;
    tapped.track = init.track;
    tapped.setup = {
      config: {
        codec: init.track.codec,
        numberOfChannels: init.track.channels,
        sampleRate: init.track.sampleRate,
        ...(init.track.description ? { description: init.track.description } : {}),
      },
    };
    retireDecoder(tapped);
    tapped.lastFrameTimestamp = undefined;
  };

  const framesOf = (tapped: TappedBuffer, bytes: Uint8Array): OpusFrame[] => {
    if (tapped.container === 'webm') {
      tapped.demuxer ??= new WebmOpusDemuxer();
      const frames = tapped.demuxer.push(bytes);
      if (!tapped.setup && tapped.demuxer.codecPrivate) {
        tapped.setup = { config: opusConfig(tapped.demuxer.codecPrivate) };
      }
      return frames;
    }
    readInit(tapped, bytes);
    return tapped.track ? parseFragments(bytes, tapped.track) : [];
  };

  const tapAppend = (tapped: TappedBuffer, data: BufferSource) => {
    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    // Recorded even while read-ahead is off, so what the player already
    // buffers can be read back when it starts; nothing is decoded or sent.
    const frames = framesOf(tapped, bytes);
    if (frames.length === 0) return;
    tapped.store.add(frames);
    if (!enabled || !tapped.setup || typeof AudioDecoder === 'undefined') return;
    if (!mainBuffers().includes(tapped)) return;
    for (const frame of frames) {
      const previous = tapped.lastFrameTimestamp;
      tapped.lastFrameTimestamp = frame.timestamp;
      if (previous !== undefined && tapped.decoder &&
        (frame.timestamp < previous || frame.timestamp - previous > MAX_FRAME_GAP_SECONDS)) {
        retireDecoder(tapped);
      }
      if (!tapped.decoder || tapped.decoder.state === 'closed') {
        tapped.decoder = createDecoder(tapped.setup, () => { tapped.decoder = undefined; });
      }
      decode(tapped.decoder, frame);
    }
  };

  const originalAdd = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (this: MediaSource, mime: string) {
    const buffer = originalAdd.call(this, mime);
    const container = containerOf(mime);
    if (!container || !mayCarryAudio(mime)) return buffer;
    const tapped: TappedBuffer = {
      buffer,
      container,
      dead: false,
      encrypted: false,
      source: this,
      store: new OpusFrameStore(),
    };
    for (let index = buffers.length - 1; index >= 0; index -= 1) {
      syncStore(buffers[index]!);
      if (buffers[index]!.dead) buffers.splice(index, 1);
    }
    buffers.push(tapped);
    buffer.addEventListener('updateend', () => syncStore(tapped));
    const originalAppend = buffer.appendBuffer;
    const originalAbort = buffer.abort;
    buffer.appendBuffer = function (this: SourceBuffer, data: BufferSource) {
      try {
        tapAppend(tapped, data);
      } catch {
        // Never let the tap break playback.
      }
      return originalAppend.call(this, data);
    };
    buffer.abort = function (this: SourceBuffer) {
      tapped.demuxer?.reset();
      return originalAbort.call(this);
    };
    return buffer;
  };

  // Whether read-ahead can read the main video here, and if not why.
  const status = async (): Promise<{ reason?: MseTapUnsupported; supported: boolean }> => {
    const video = mainVideo();
    if (video?.mediaKeys) return { reason: 'drm', supported: false };
    const main = mainBuffers();
    if (main.some((tapped) => tapped.encrypted)) return { reason: 'drm', supported: false };
    const readable = main.find((tapped) => tapped.setup);
    if (!readable) {
      return { reason: main.some((tapped) => tapped.unknownCodec) ? 'codec' : 'no_audio', supported: false };
    }
    if (typeof AudioDecoder === 'undefined') return { reason: 'codec', supported: false };
    const support = await AudioDecoder.isConfigSupported(readable.setup!.config).catch(() => undefined);
    return support?.supported ? { supported: true } : { reason: 'codec', supported: false };
  };

  view.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== view) return;
    const message = event.data as { enabled?: unknown; source?: unknown; time?: unknown; type?: unknown } | null;
    if (message?.source !== TAP_MESSAGE_SOURCE) return;
    if (message.type === 'probe') {
      void status().then(({ reason, supported }) => {
        const reply: TapToContentMessage = {
          source: TAP_MESSAGE_SOURCE,
          supported,
          type: 'probe-result',
          ...(reason ? { reason } : {}),
        };
        view.postMessage(reply, view.location.origin);
      });
      return;
    }
    const time = typeof message.time === 'number' && Number.isFinite(message.time) ? message.time : undefined;
    // With no player to reload, a seek or a stall can only be served from what
    // is stored; audio the player dropped comes back when it fetches it again.
    if ((message.type === 'seek' || message.type === 'refill') && time !== undefined) {
      replay(message.type === 'refill' ? Math.max(0, time - SEEK_LOOKBACK_SECONDS) : time);
      return;
    }
    if (message.type !== 'enable') return;
    enabled = message.enabled === true;
    if (!enabled) {
      emitter.reset();
      for (const tapped of buffers) retireDecoder(tapped);
      return;
    }
    const viewer = mainVideo()?.currentTime ?? 0;
    replay(Math.max(0, viewer - SEEK_LOOKBACK_SECONDS));
  });
}
