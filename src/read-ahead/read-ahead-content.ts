// Isolated-world side of read-ahead mode: finds the main player, picks the
// audio source (buffer tap on YouTube, shadow player for plain video files),
// runs a ReadAheadSession against them and relays cues, statuses and chunk
// translations through the background.
import type { ReadAheadStartRequest, TabMessage } from '../core/capture-session-controller';
import type { ExtensionMessage } from '../core/messages';
import { findLargestVisibleVideo } from '../content/media-locator';
import type { ChunkSentence } from './gemini-chunk-translation';
import { encodeWav, toBase64 } from './gemini-chunk-translation';
import {
  ReadAheadSession,
  type MainPlayer,
  type ReadAheadStatus,
  type ReadAheadSource,
} from './read-ahead-session';
import { ShadowPlayerSource } from './shadow-player-source';
import {
  TAP_MESSAGE_SOURCE,
  type ContentToTapMessage,
  type TapToContentMessage,
} from './youtube-buffer-tap';

const INSTALL_KEY = '__bilingualReadAheadInstalled';
const TICK_MS = 100;

type ReadAheadWindow = Window & { [INSTALL_KEY]?: boolean };

function isYouTube(location: Location): boolean {
  return /(^|\.)youtube\.com$/.test(location.hostname);
}

function send(message: ExtensionMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

interface Running {
  dispose(): void;
  mediaKey: string;
}

export function installReadAhead(document: Document): void {
  const view = document.defaultView as ReadAheadWindow | null;
  if (!view || view[INSTALL_KEY]) return;
  view[INSTALL_KEY] = true;

  let request: ReadAheadStartRequest | undefined;
  let running: Running | undefined;
  let watchdog: number | undefined;

  const youtube = isYouTube(view.location);

  const findMainVideo = (): HTMLVideoElement | undefined =>
    (youtube ? document.querySelector<HTMLVideoElement>('#movie_player video') : null) ??
    findLargestVisibleVideo(document);

  const mediaKeyOf = (video: HTMLVideoElement): string =>
    youtube
      ? new URLSearchParams(view.location.search).get('v') ?? view.location.pathname
      : video.currentSrc;

  const adPlaying = () =>
    youtube &&
    Boolean(document.querySelector('#movie_player')?.classList.contains('ad-showing'));

  const postToTap = (enabled: boolean) => {
    const message: ContentToTapMessage = { enabled, source: TAP_MESSAGE_SOURCE, type: 'enable' };
    view.postMessage(message, view.location.origin);
  };

  const reportStatus = (sessionId: string, status?: ReadAheadStatus | 'unsupported') =>
    void send({
      target: 'background',
      type: 'READ_AHEAD_STATUS',
      payload: { sessionId, ...(status ? { status } : {}) },
    }).catch(() => undefined);

  // Why read-ahead cannot run here, or undefined when it can.
  const unsupportedReason = (video: HTMLVideoElement | undefined): string | undefined => {
    if (!video) return 'no_video';
    if (video.mediaKeys) return 'drm';
    if (video.duration === Infinity) return 'live';
    if (youtube) return undefined;
    if (!video.currentSrc || video.currentSrc.startsWith('blob:')) return 'stream';
    return undefined;
  };

  const startOn = (video: HTMLVideoElement, active: ReadAheadStartRequest): Running => {
    const { sessionId } = active;
    let session: ReadAheadSession | undefined;
    let source: ReadAheadSource & { dispose?(): void };
    let removeTapListener = () => undefined as void;

    if (youtube) {
      const toTap = (message: ContentToTapMessage) =>
        view.postMessage(message, view.location.origin);
      source = {
        refill: (time) => toTap({ source: TAP_MESSAGE_SOURCE, time, type: 'refill' }),
        // The tap reads YouTube's own buffer; "seeking" it means sending the
        // stored audio from there again.
        seek: (time) => toTap({ source: TAP_MESSAGE_SOURCE, time, type: 'seek' }),
        setRunning() {},
      };
      const onTapMessage = (event: MessageEvent<unknown>) => {
        if (event.source !== view) return;
        const message = event.data as Partial<TapToContentMessage> | null;
        if (message?.source !== TAP_MESSAGE_SOURCE || message.type !== 'audio') return;
        if (!(message.samples instanceof Float32Array) || typeof message.start !== 'number') return;
        session?.acceptAudio({ samples: message.samples, start: message.start });
      };
      view.addEventListener('message', onTapMessage);
      removeTapListener = () => view.removeEventListener('message', onTapMessage);
    } else {
      source = new ShadowPlayerSource(document, video.currentSrc, (block) =>
        session?.acceptAudio(block));
    }

    const main: MainPlayer = {
      adPlaying,
      currentTime: () => video.currentTime,
      duration: () => Number.isFinite(video.duration) ? video.duration : Infinity,
      pause: () => video.pause(),
      paused: () => video.paused,
      play: () => void video.play().catch(() => undefined),
      playbackRate: () => video.playbackRate,
    };

    session = new ReadAheadSession({
      main,
      showCue: (cue) =>
        void send({
          target: 'background',
          type: 'READ_AHEAD_CUE',
          payload: { sessionId, ...(cue ? { cue } : {}) },
        }).catch(() => undefined),
      showStatus: (status) => reportStatus(sessionId, status),
      now: () => Date.now(),
      source,
      async translate(samples): Promise<ChunkSentence[]> {
        const response = await send({
          target: 'background',
          type: 'READ_AHEAD_TRANSLATE',
          payload: { audioBase64: toBase64(encodeWav(samples)), sessionId },
        }) as {
          error?: string;
          ok?: boolean;
          sentences?: ChunkSentence[];
        } | undefined;
        if (!response?.ok || !Array.isArray(response.sentences)) {
          throw new Error(response?.error ?? 'translation_failed');
        }
        return response.sentences;
      },
    });

    const onPause = () => session?.onMainPause();
    const onPlay = () => session?.onMainPlay();
    const onSeeking = () => session?.onMainSeeking();
    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);
    video.addEventListener('seeking', onSeeking);
    const interval = view.setInterval(() => session?.tick(), TICK_MS);
    if (youtube) postToTap(true);
    session.tick();

    return {
      dispose() {
        view.clearInterval(interval);
        video.removeEventListener('pause', onPause);
        video.removeEventListener('play', onPlay);
        video.removeEventListener('seeking', onSeeking);
        session?.dispose();
        session = undefined;
        source.dispose?.();
        removeTapListener();
        if (youtube) postToTap(false);
      },
      mediaKey: mediaKeyOf(video),
    };
  };

  // Starts, or restarts after the viewer moved to another video: a new video
  // starts with an empty cue cache.
  const ensureRunning = () => {
    if (!request) return;
    const video = findMainVideo();
    if (running && video && running.mediaKey === mediaKeyOf(video)) return;
    if (video && video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    running?.dispose();
    running = undefined;
    const reason = unsupportedReason(video);
    if (reason || !video) {
      reportStatus(request.sessionId, 'unsupported');
      return;
    }
    reportStatus(request.sessionId);
    running = startOn(video, request);
  };

  const stop = () => {
    running?.dispose();
    running = undefined;
    request = undefined;
    if (watchdog !== undefined) view.clearInterval(watchdog);
    watchdog = undefined;
  };

  chrome.runtime.onMessage.addListener((incoming: unknown, sender) => {
    if (sender.id !== chrome.runtime.id || sender.tab !== undefined) return false;
    const message = incoming as TabMessage | null;
    if (message?.type === 'READ_AHEAD_START') {
      if (request?.sessionId === message.payload.sessionId) return false;
      stop();
      request = message.payload;
      ensureRunning();
      watchdog = view.setInterval(ensureRunning, 1000);
    } else if (message?.type === 'READ_AHEAD_STOP') {
      if (request?.sessionId === message.payload.sessionId) stop();
    }
    return false;
  });
}
