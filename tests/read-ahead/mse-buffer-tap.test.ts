import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMseTap } from '../../src/read-ahead/mse-buffer-tap';
import { TAP_MESSAGE_SOURCE } from '../../src/read-ahead/youtube-buffer-tap';
import { aacInit, fragment } from './fmp4-fixtures';

class FakeSourceBuffer extends EventTarget {
  appended: Uint8Array[] = [];
  ranges: Array<[number, number]> = [];
  updating = false;
  get buffered() {
    const ranges = this.ranges;
    return { length: ranges.length, start: (i: number) => ranges[i]![0], end: (i: number) => ranges[i]![1] };
  }
  appendBuffer(data: Uint8Array) {
    this.appended.push(data);
  }
  abort() {}
}

// A fresh class per test: installing the tap patches its prototype.
let FakeMediaSource = makeMediaSource();
function makeMediaSource() {
  return class {
    addSourceBuffer(_mime: string) {
      return new FakeSourceBuffer() as unknown as SourceBuffer;
    }
  };
}

const decoded: Array<{ timestamp: number }> = [];
class FakeAudioDecoder {
  static isConfigSupported = vi.fn(async (config: AudioDecoderConfig) => ({ config, supported: config.codec === 'mp4a.40.2' }));
  state = 'configured';
  constructor(private init: AudioDecoderInit) {}
  configure() {}
  decode(chunk: { timestamp: number }) {
    decoded.push({ timestamp: chunk.timestamp });
    const frames = 1024 * 3;
    const data = {
      close: () => undefined,
      copyTo: (plane: Float32Array) => plane.fill(0.5),
      numberOfChannels: 2,
      numberOfFrames: frames,
      sampleRate: 48_000,
      timestamp: chunk.timestamp,
    };
    this.init.output(data as unknown as AudioData);
  }
  flush() { return Promise.resolve(); }
  close() { this.state = 'closed'; }
}

const listeners: EventListener[] = [];

function setup() {
  FakeMediaSource = makeMediaSource();
  const view = window;
  Object.assign(view, { MediaSource: FakeMediaSource });
  vi.stubGlobal('MediaSource', FakeMediaSource);
  vi.stubGlobal('AudioDecoder', FakeAudioDecoder);
  vi.stubGlobal('EncodedAudioChunk', class { timestamp: number; constructor(init: { timestamp: number }) { this.timestamp = init.timestamp; } });
  const posted: unknown[] = [];
  vi.spyOn(view, 'postMessage').mockImplementation((message: unknown) => {
    posted.push(message);
    view.dispatchEvent(new MessageEvent('message', { data: message, source: view }));
  });
  // Each test's tap listens on the same window: remove it afterwards.
  const add = vi.spyOn(view, 'addEventListener');
  installMseTap(view);
  for (const [type, listener] of add.mock.calls) {
    if (type === 'message') listeners.push(listener as EventListener);
  }
  return { posted, view };
}

const send = (view: Window, message: object) =>
  view.dispatchEvent(new MessageEvent('message', { data: { source: TAP_MESSAGE_SOURCE, ...message }, source: view }));

describe('MediaSource tap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    decoded.length = 0;
    delete (window as unknown as Record<string, unknown>).__bilingualMseTapInstalled;
  });
  afterEach(() => {
    for (const listener of listeners.splice(0)) window.removeEventListener('message', listener);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('marks the page, records audio appends without sending anything, and still feeds the player', () => {
    const { posted, view } = setup();
    expect(document.documentElement.dataset.bilingualMseTap).toBe('1');
    const source = new FakeMediaSource() as unknown as MediaSource;
    const buffer = source.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"') as unknown as FakeSourceBuffer;
    buffer.appendBuffer(aacInit());
    buffer.appendBuffer(fragment(2, 48_000 * 10, [4, 4]));
    expect(buffer.appended).toHaveLength(2);
    vi.advanceTimersByTime(1_000);
    expect(decoded).toEqual([]);
    expect(posted.filter((message) => (message as { type?: string }).type === 'audio')).toEqual([]);
    void view;
  });

  it('once enabled, decodes what was stored and new appends into 16 kHz blocks', async () => {
    const { posted, view } = setup();
    const source = new FakeMediaSource() as unknown as MediaSource;
    const buffer = source.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"') as unknown as FakeSourceBuffer;
    buffer.appendBuffer(aacInit());
    buffer.appendBuffer(fragment(2, 0, [4, 4]));
    buffer.ranges = [[0, 10]];
    send(view, { enabled: true, type: 'enable' });
    buffer.appendBuffer(fragment(2, 2048, [4]));
    vi.advanceTimersByTime(500);
    const audio = posted.filter((message) => (message as { type?: string }).type === 'audio') as Array<{ samples: Float32Array; start: number }>;
    expect(decoded.map(({ timestamp }) => timestamp)).toEqual([0, Math.round(1024 / 48_000 * 1e6), Math.round(2048 / 48_000 * 1e6)]);
    expect(audio.length).toBeGreaterThan(0);
    expect(audio[0]!.start).toBe(0);
    expect(audio[0]!.samples[0]).toBeCloseTo(0.5);
  });

  it('answers a probe: readable AAC is supported, encrypted audio is DRM, video-only buffers are skipped', async () => {
    const { posted, view } = setup();
    const source = new FakeMediaSource() as unknown as MediaSource;
    const video = source.addSourceBuffer('video/mp4; codecs="avc1.64001f"') as unknown as FakeSourceBuffer;
    video.appendBuffer(aacInit({ entry: 'enca' }));
    send(view, { type: 'probe' });
    await vi.runAllTimersAsync();
    expect(posted.at(-1)).toMatchObject({ reason: 'no_audio', supported: false, type: 'probe-result' });

    const audio = source.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"') as unknown as FakeSourceBuffer;
    audio.appendBuffer(aacInit());
    send(view, { type: 'probe' });
    await vi.runAllTimersAsync();
    expect(posted.at(-1)).toMatchObject({ supported: true, type: 'probe-result' });
  });

  it('reports encrypted audio as DRM', async () => {
    const { posted, view } = setup();
    const source = new FakeMediaSource() as unknown as MediaSource;
    const audio = source.addSourceBuffer('audio/mp4') as unknown as FakeSourceBuffer;
    audio.appendBuffer(aacInit({ entry: 'enca' }));
    send(view, { type: 'probe' });
    await vi.runAllTimersAsync();
    expect(posted.at(-1)).toMatchObject({ reason: 'drm', supported: false });
  });
});
