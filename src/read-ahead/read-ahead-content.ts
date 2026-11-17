// Isolated-world side of read-ahead mode: finds the main player, picks the
// audio source (buffer tap on YouTube, shadow player for plain video files),
// runs a ReadAheadSession against them and relays cues, statuses and chunk
// translations through the background.
import type { ReadAheadStartRequest, TabMessage } from '../core/capture-session-controller';
import type { ExtensionMessage } from '../core/messages';
import { findLargestVisibleVideo } from '../content/media-locator';
import type { ChunkSentence } from './gemini-chunk-translation';
import {
  CHUNK_REQUEST_TIMEOUT_MS,
  encodeWav,
  toBase64,
  withDeadline,
} from './gemini-chunk-translation';
import {
  ReadAheadSession,
  SAMPLE_RATE,
  type MainPlayer,
  type ReadAheadStatus,
  type ReadAheadSource,
} from './read-ahead-session';
import { ChromeTranslation } from './chrome-translation';
import { ShadowPlayerSource } from './shadow-player-source';
import {
  TAP_MESSAGE_SOURCE,
  type ContentToTapMessage,
  type TapToContentMessage,
} from './youtube-buffer-tap';

const INSTALL_KEY = '__bilingualReadAheadInstalled';
const LOG_PREFIX = '[Bilingual Captions][read-ahead]';
// The background answers within CHUNK_REQUEST_TIMEOUT_MS (its requests time
// out); this covers the message round trip on top. Whatever the cause, a
// chunk that is not back by then fails rather than holding the viewer.
const PAGE_DEADLINE_MS = CHUNK_REQUEST_TIMEOUT_MS + 1_500;
// The least time a translation step gets, however late the background was.
const MIN_PAGE_TRANSLATION_MS = 1_000;
// Chrome's on-device Translator answers in milliseconds; past this it is
// stuck, and the web fallback gets the rest of the budget.
const CHROME_TRANSLATION_MS = 3_000;
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
  // Kept for the page's lifetime: translators are cached per language pair.
  const chromeTranslation = ChromeTranslation.fromWindow(view);

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

  const translateOnWeb = async (
    sentences: ChunkSentence[],
    languages: { sourceLanguage?: string; targetLanguage: string },
    timeoutMs: number,
  ): Promise<ChunkSentence[]> => {
    const sessionId = request?.sessionId;
    if (!sessionId) throw new Error('inactive_session');
    const response = await withDeadline(send({
      target: 'background',
      type: 'READ_AHEAD_WEB_TRANSLATE',
      payload: {
        sessionId,
        ...languages,
        texts: sentences.map((sentence) => sentence.original),
        timeoutMs,
      },
    }), timeoutMs + 500, 'web_translation_timeout') as {
      error?: string;
      ok?: boolean;
      translations?: string[];
    } | undefined;
    if (!response?.ok || !Array.isArray(response.translations)) {
      throw new Error(`web_translation_${response?.error ?? 'failed'}`);
    }
    return sentences.map((sentence, index) => ({
      ...sentence,
      translation: response.translations![index] ?? '',
    }));
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
        const started = Date.now();
        try {
          const response = await withDeadline(send({
            target: 'background',
            type: 'READ_AHEAD_TRANSLATE',
            payload: { audioBase64: toBase64(encodeWav(samples)), sessionId },
          }), PAGE_DEADLINE_MS, 'background_timeout') as {
            error?: string;
            ok?: boolean;
            sentences?: ChunkSentence[];
            translateInPage?: { sourceLanguage?: string; targetLanguage: string };
          } | undefined;
          if (!response?.ok || !Array.isArray(response.sentences)) {
            throw new Error(response?.error ?? 'translation_failed');
          }
          if (!response.translateInPage) return response.sentences;
          const languages = response.translateInPage;
          const remaining = () =>
            Math.max(MIN_PAGE_TRANSLATION_MS, PAGE_DEADLINE_MS - (Date.now() - started));
          try {
            return await withDeadline(
              chromeTranslation.translate(response.sentences, languages),
              Math.min(CHROME_TRANSLATION_MS, remaining()),
              'translator_timeout',
            );
          } catch (error) {
            const reason = error instanceof Error ? error.message : '';
            if (reason !== 'translator_unsupported' && reason !== 'translator_timeout') throw error;
            // The on-device Translator cannot do it here: Google's web
            // translation, through the background (ADR 0002).
            return await translateOnWeb(response.sentences, languages, remaining());
          }
        } catch (error) {
          // Logged so a failing chunk can be diagnosed from the page console.
          console.warn(LOG_PREFIX, 'chunk failed', {
            ms: Date.now() - started,
            reason: error instanceof Error ? error.message : String(error),
            seconds: +(samples.length / SAMPLE_RATE).toFixed(1),
          });
          throw error;
        }
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
