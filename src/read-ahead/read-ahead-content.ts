// Isolated-world side of read-ahead mode: finds the main player, looks for a
// caption track (ADR 0007) and runs a CaptionTrackSession on it, or else picks
// the audio source (buffer tap on YouTube, shadow player for plain video
// files) and runs a ReadAheadSession; relays cues, statuses and translations
// through the background.
import type {
  ReadAheadStartRequest,
  ReadAheadStatusCode,
  TabMessage,
} from '../core/capture-session-controller';
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
  type DisplayedCue,
  type MainPlayer,
  type ReadAheadStatus,
  type ReadAheadSource,
} from './read-ahead-session';
import { ChromeTranslation } from './chrome-translation';
import { PageTranslation, type PageLanguages, type PageTranslationResult } from './page-translation';
import type { TranslationContext } from './groq-translation';
import {
  languageCodeOf,
  pairTranslations,
  sentencesFromLines,
  type LoadedCaptionTracks,
} from './caption-track';
import { CaptionTrackSession } from './caption-track-session';
import { loadHtmlCaptionTracks } from './html-caption-tracks';
import {
  CAPTION_MESSAGE_SOURCE,
  type CaptionTapToContentMessage,
  type ContentToCaptionTapMessage,
} from './youtube-caption-tap';
import { ShadowPlayerSource } from './shadow-player-source';
import {
  MSE_TAP_MARKER,
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
// How long the notice that Groq (Qwen) could not translate stays up.
const TRANSLATOR_NOTICE_MS = 4_000;
const TICK_MS = 100;
// How long the MediaSource tap gets to answer a probe.
const MSE_PROBE_MS = 1_000;
const CLOCK_MS = 2_000;
// How long a video may wait for its caption tracks before the recognizer runs
// instead (ADR 0007).
const CAPTION_WAIT_MS = 2_000;
// How long "使用 YouTube 字幕" stays up.
const CAPTION_NOTICE_MS = 4_000;
// YouTube's own caption rendering, hidden while ours show from its tracks.
const HIDE_YOUTUBE_CAPTIONS_ID = 'bilingual-read-ahead-hide-youtube-captions';
const HIDE_YOUTUBE_CAPTIONS_CSS =
  '#movie_player .ytp-caption-window-container { display: none !important; }';

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

// What both kinds of session take from the main player's events.
interface PlayerDriven {
  dispose(): void;
  onMainPause(): void;
  onMainPlay(): void;
  onMainSeeking(): void;
  tick(): void;
}


export function installReadAhead(document: Document): void {
  const view = document.defaultView as ReadAheadWindow | null;
  if (!view || view[INSTALL_KEY]) return;
  view[INSTALL_KEY] = true;

  let request: ReadAheadStartRequest | undefined;
  let running: Running | undefined;
  // The video whose caption tracks are being looked for.
  let starting: string | undefined;
  let watchdog: number | undefined;
  let captionRequests = 0;

  const youtube = isYouTube(view.location);
  // Kept for the page's lifetime: translators are cached per language pair.
  const chromeTranslation = ChromeTranslation.fromWindow(view);

  const findMainVideo = (): HTMLVideoElement | undefined =>
    (youtube ? document.querySelector<HTMLVideoElement>('#movie_player video') : null) ??
    findLargestVisibleVideo(document);

  // Which video this is, to start over when the viewer moves to another one.
  // A stream's blob: source changes whenever its player rebuilds the
  // MediaSource; there the page address names the video instead.
  const mediaKeyOf = (video: HTMLVideoElement): string =>
    youtube
      ? new URLSearchParams(view.location.search).get('v') ?? view.location.pathname
      : video.currentSrc.startsWith('blob:')
        ? `${view.location.origin}${view.location.pathname}${view.location.search}`
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

  // Groq (Qwen), through the background, which holds the Groq key (issue #29).
  const translateWithGroq = async (
    texts: string[],
    languages: PageLanguages,
    context: TranslationContext[],
    timeoutMs: number,
  ): Promise<string[]> => {
    const sessionId = request?.sessionId;
    if (!sessionId) throw new Error('inactive_session');
    const response = await withDeadline(send({
      target: 'background',
      type: 'READ_AHEAD_GROQ_TRANSLATE',
      payload: { context, sessionId, ...languages, texts, timeoutMs },
    }), timeoutMs + 500, 'timeout') as {
      detail?: string;
      error?: string;
      ok?: boolean;
      translations?: string[];
    } | undefined;
    if (!response?.ok || !Array.isArray(response.translations)) {
      const code = response?.error ?? 'invalid_response';
      throw new Error(response?.detail ? `${code}: ${response.detail}` : code);
    }
    return response.translations;
  };

  // The chunk translation chain for one video (ADR 0006, issue #29): Groq
  // (Qwen) when chosen, Chrome's on-device Translator, Google's web
  // translation. A fresh one per video, so its context starts empty.
  const pageTranslationFor = (active: ReadAheadStartRequest) => new PageTranslation({
    chrome: (sentences, languages) => chromeTranslation.translate(sentences, languages),
    groq: translateWithGroq,
    now: () => Date.now(),
    web: translateOnWeb,
  }, active.translator);

  // What the page last told the overlay, so a passing notice never covers a
  // hold or a failure.
  let shownStatus: string | undefined;
  let fallbackShown: PageTranslationResult['fallback'];
  let fallbackNotice: number | undefined;
  // After a chunk Groq (Qwen) could not translate: a short notice that
  // Chrome's Translator stood in, once per run of such chunks. Posted after
  // the session has taken the chunk (and cleared its own status).
  const noteTranslator = (sessionId: string, result: PageTranslationResult) => {
    if (!result.fallback) {
      if (result.translator === 'groq') fallbackShown = undefined;
      return;
    }
    console.warn(LOG_PREFIX, 'Groq (Qwen) did not translate this chunk', JSON.stringify({
      reason: result.fallbackReason,
      translator: result.translator,
    }));
    if (fallbackShown === result.fallback) return;
    fallbackShown = result.fallback;
    const status = result.fallback === 'quota' ? 'translator_quota_fallback' : 'translator_fallback';
    view.setTimeout(() => {
      if (shownStatus !== undefined || request?.sessionId !== sessionId) return;
      reportStatus(sessionId, status);
      view.clearTimeout(fallbackNotice);
      fallbackNotice = view.setTimeout(() => {
        if (shownStatus === status && request?.sessionId === sessionId) reportStatus(sessionId);
      }, TRANSLATOR_NOTICE_MS);
    }, 0);
  };

  const reportStatus = (sessionId: string, status?: ReadAheadStatusCode) => {
    shownStatus = status;
    void send({
      target: 'background',
      type: 'READ_AHEAD_STATUS',
      payload: { sessionId, ...(status ? { status } : {}) },
    }).catch(() => undefined);
  };

  // Why read-ahead cannot run here at all, or undefined when it may.
  const unsupportedReason = (video: HTMLVideoElement | undefined): string | undefined => {
    if (!video) return 'no_video';
    if (video.mediaKeys) return 'drm';
    if (video.duration === Infinity) return 'live';
    return undefined;
  };

  // Asks the MediaSource tap (ADR 0009) whether it can read the main video.
  const probeMseTap = (): Promise<{ reason?: string; supported: boolean }> => new Promise((resolve) => {
    const finish = (result: { reason?: string; supported: boolean }) => {
      view.clearTimeout(timer);
      view.removeEventListener('message', onMessage);
      resolve(result);
    };
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== view) return;
      const message = event.data as Partial<TapToContentMessage> | null;
      if (message?.source !== TAP_MESSAGE_SOURCE || message.type !== 'probe-result') return;
      const { reason, supported } = message as { reason?: string; supported?: boolean };
      finish({ ...(reason ? { reason } : {}), supported: supported === true });
    };
    const timer = view.setTimeout(() => finish({ supported: false }), MSE_PROBE_MS);
    view.addEventListener('message', onMessage);
    const probe: ContentToTapMessage = { source: TAP_MESSAGE_SOURCE, type: 'probe' };
    view.postMessage(probe, view.location.origin);
  });

  // How read-ahead reads this video's audio (ADR 0009): the MediaSource tap
  // on an allowed site; YouTube's own tap; a shadow player for a plain file.
  // A stream elsewhere needs the site allowed; DRM or an unreadable codec is
  // unsupported. (A caption track can serve any of them.)
  const audioSource = async (
    video: HTMLVideoElement,
  ): Promise<{ kind: 'shadow' | 'tap' } | { status: 'needs_site_access' | 'unsupported' }> => {
    if (document.documentElement.dataset[MSE_TAP_MARKER]) {
      const { reason } = await probeMseTap();
      // 'no_audio' may only mean the player has not appended yet.
      return reason === 'drm' || reason === 'codec' ? { status: 'unsupported' } : { kind: 'tap' };
    }
    if (youtube) return { kind: 'tap' };
    if (!video.currentSrc) return { status: 'unsupported' };
    if (video.currentSrc.startsWith('blob:')) return { status: 'needs_site_access' };
    return { kind: 'shadow' };
  };

  // Wires a session to the main player's events and the tick.
  // The main player's time for the side panel's word highlight, which cannot
  // read it: on every change of pace, and every CLOCK_MS against drift (a
  // player stalled on the network is not paused, but its time stands still).
  const reportClock = (sessionId: string, video: HTMLVideoElement) =>
    void send({
      target: 'background',
      type: 'READ_AHEAD_CLOCK',
      payload: {
        clock: {
          at: Date.now(),
          paused: video.paused || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA,
          rate: video.playbackRate,
          time: video.currentTime,
        },
        sessionId,
      },
    }).catch(() => undefined);

  const attach = (
    video: HTMLVideoElement,
    session: PlayerDriven,
    sessionId: string,
  ): (() => void) => {
    const clock = () => reportClock(sessionId, video);
    const onPause = () => { session.onMainPause(); clock(); };
    const onPlay = () => { session.onMainPlay(); clock(); };
    const onSeeking = () => session.onMainSeeking();
    const clockEvents = ['playing', 'ratechange', 'seeked', 'waiting'] as const;
    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);
    video.addEventListener('seeking', onSeeking);
    for (const event of clockEvents) video.addEventListener(event, clock);
    const interval = view.setInterval(() => session.tick(), TICK_MS);
    const clockInterval = view.setInterval(clock, CLOCK_MS);
    session.tick();
    clock();
    return () => {
      view.clearInterval(interval);
      view.clearInterval(clockInterval);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('seeking', onSeeking);
      for (const event of clockEvents) video.removeEventListener(event, clock);
      session.dispose();
    };
  };

  const mainPlayer = (video: HTMLVideoElement): MainPlayer => ({
    adPlaying,
    currentTime: () => video.currentTime,
    duration: () => Number.isFinite(video.duration) ? video.duration : Infinity,
    pause: () => video.pause(),
    paused: () => video.paused,
    play: () => void video.play().catch(() => undefined),
    playbackRate: () => video.playbackRate,
  });

  const showCue = (sessionId: string) => (cue: DisplayedCue | undefined) =>
    void send({
      target: 'background',
      type: 'READ_AHEAD_CUE',
      payload: { sessionId, ...(cue ? { cue } : {}) },
    }).catch(() => undefined);

  // The video's caption tracks, or undefined after CAPTION_WAIT_MS.
  const findCaptionTracks = (
    video: HTMLVideoElement,
    active: ReadAheadStartRequest,
  ): Promise<LoadedCaptionTracks | undefined> => {
    const languages: PageLanguages = {
      ...(active.sourceLanguage ? { sourceLanguage: active.sourceLanguage } : {}),
      targetLanguage: active.targetLanguage,
    };
    if (!youtube) {
      return loadHtmlCaptionTracks(video, languages, CAPTION_WAIT_MS).catch(() => undefined);
    }
    const requestId = `${active.sessionId}:${++captionRequests}`;
    return new Promise((resolve) => {
      const finish = (tracks?: LoadedCaptionTracks) => {
        view.clearTimeout(timer);
        view.removeEventListener('message', onMessage);
        resolve(tracks);
      };
      const onMessage = (event: MessageEvent<unknown>) => {
        if (event.source !== view) return;
        const message = event.data as Partial<CaptionTapToContentMessage> | null;
        if (message?.source !== CAPTION_MESSAGE_SOURCE || message.type !== 'tracks') return;
        if (message.requestId !== requestId) return;
        finish(message.original
          ? {
              original: message.original,
              sameLanguage: Boolean(message.sameLanguage),
              site: 'youtube',
              ...(message.target ? { target: message.target } : {}),
            }
          : undefined);
      };
      const timer = view.setTimeout(() => finish(undefined), CAPTION_WAIT_MS);
      view.addEventListener('message', onMessage);
      const ask: ContentToCaptionTapMessage = {
        ...languages,
        requestId,
        source: CAPTION_MESSAGE_SOURCE,
        type: 'request',
        videoId: mediaKeyOf(video),
      };
      view.postMessage(ask, view.location.origin);
    });
  };

  const setYouTubeCaptionsHidden = (hidden: boolean) => {
    document.getElementById(HIDE_YOUTUBE_CAPTIONS_ID)?.remove();
    if (!hidden) return;
    const style = document.createElement('style');
    style.id = HIDE_YOUTUBE_CAPTIONS_ID;
    style.textContent = HIDE_YOUTUBE_CAPTIONS_CSS;
    (document.head ?? document.documentElement).append(style);
  };

  const startCaptions = (
    video: HTMLVideoElement,
    active: ReadAheadStartRequest,
    tracks: LoadedCaptionTracks,
  ): Running => {
    const { sessionId } = active;
    const sentences = sentencesFromLines(tracks.original.lines);
    const languages: PageLanguages = {
      sourceLanguage: languageCodeOf(tracks.original.language),
      targetLanguage: active.targetLanguage,
    };
    // The session's own status, so the notice never hides a hold or failure.
    let sessionStatus: ReadAheadStatus;
    const pageTranslation = pageTranslationFor(active);
    const session = new CaptionTrackSession({
      main: mainPlayer(video),
      sameLanguage: tracks.sameLanguage,
      sentences,
      showCue: showCue(sessionId),
      showStatus(status) {
        sessionStatus = status;
        reportStatus(sessionId, status);
      },
      ...(tracks.target
        ? { translations: pairTranslations(sentences, tracks.target.lines) }
        : {}),
      async translate(texts) {
        const started = Date.now();
        const translated = await pageTranslation.translate(
          texts.map((original) => ({
            cut: false,
            end: 0,
            original,
            sameLanguage: false,
            start: 0,
            translation: '',
          })),
          languages,
          started,
          PAGE_DEADLINE_MS,
        ).catch((error: unknown) => {
          console.warn(LOG_PREFIX, 'caption translation failed', {
            ms: Date.now() - started,
            reason: error instanceof Error ? error.message : String(error),
            sentences: texts.length,
          });
          throw error;
        });
        noteTranslator(sessionId, translated);
        return translated.sentences.map((sentence) => sentence.translation);
      },
    });
    if (tracks.site === 'youtube') setYouTubeCaptionsHidden(true);
    const detach = attach(video, session, sessionId);
    reportStatus(sessionId, tracks.site === 'youtube' ? 'captions_youtube' : 'captions_video');
    const notice = view.setTimeout(() => {
      if (sessionStatus === undefined) reportStatus(sessionId);
    }, CAPTION_NOTICE_MS);
    return {
      dispose() {
        view.clearTimeout(notice);
        detach();
        if (tracks.site === 'youtube') setYouTubeCaptionsHidden(false);
      },
      mediaKey: mediaKeyOf(video),
    };
  };

  const startAudio = (
    video: HTMLVideoElement,
    active: ReadAheadStartRequest,
    kind: 'shadow' | 'tap',
  ): Running => {
    const tapped = kind === 'tap';
    const { sessionId } = active;
    let session: ReadAheadSession | undefined;
    let source: ReadAheadSource & { dispose?(): void };
    let removeTapListener = () => undefined as void;

    if (tapped) {
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

    const pageTranslation = pageTranslationFor(active);
    session = new ReadAheadSession({
      main: mainPlayer(video),
      showCue: showCue(sessionId),
      showStatus: (status) => reportStatus(sessionId, status),
      log: (event, details) => console.debug(LOG_PREFIX, event, JSON.stringify(details)),
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
          const translated = await pageTranslation.translate(
            response.sentences,
            response.translateInPage,
            started,
            PAGE_DEADLINE_MS,
          );
          noteTranslator(sessionId, translated);
          return translated.sentences;
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

    if (tapped) postToTap(true);
    const detach = attach(video, session, sessionId);

    return {
      dispose() {
        detach();
        session = undefined;
        source.dispose?.();
        removeTapListener();
        if (tapped) postToTap(false);
      },
      mediaKey: mediaKeyOf(video),
    };
  };

  // Looks for the video's caption tracks, holding it with "讀取字幕中…" for
  // at most CAPTION_WAIT_MS, then starts on them or on the audio (ADR 0007).
  const start = async (video: HTMLVideoElement, active: ReadAheadStartRequest) => {
    const mediaKey = mediaKeyOf(video);
    const startOnAudio = async () => {
      starting = mediaKey;
      const source = await audioSource(video);
      if (starting !== mediaKey || request !== active) return;
      starting = undefined;
      if ('status' in source) {
        reportStatus(active.sessionId, source.status);
        return;
      }
      reportStatus(active.sessionId);
      running = startAudio(video, active, source.kind);
    };
    // The viewer turned caption tracks off: recognize, as before ADR 0007.
    if (!active.preferCaptionTracks) {
      await startOnAudio();
      return;
    }
    starting = mediaKey;
    const wasPlaying = !video.paused;
    if (wasPlaying) video.pause();
    reportStatus(active.sessionId, 'captions_loading');
    const tracks = await findCaptionTracks(video, active);
    if (starting !== mediaKey || request !== active) return;
    starting = undefined;
    // Resumed only if the viewer did not pause it meanwhile; the sessions
    // hold it again themselves if they must.
    if (wasPlaying && video.paused) void video.play().catch(() => undefined);
    if (tracks) {
      running = startCaptions(video, active, tracks);
    } else {
      await startOnAudio();
    }
  };

  // Starts, or restarts after the viewer moved to another video: a new video
  // starts with an empty cue cache and is looked at for caption tracks again.
  const ensureRunning = () => {
    // Cut off from the extension (reloaded or updated): no chunk can be
    // translated any more, so read-ahead stops and lets go of a held video.
    if (!chrome.runtime?.id) {
      stop();
      return;
    }
    if (!request) return;
    const video = findMainVideo();
    const key = video && mediaKeyOf(video);
    if (running && key && running.mediaKey === key) return;
    if (starting !== undefined && starting === key) return;
    if (video && video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    running?.dispose();
    running = undefined;
    starting = undefined;
    const reason = unsupportedReason(video);
    if (reason || !video) {
      reportStatus(request.sessionId, 'unsupported');
      return;
    }
    void start(video, request);
  };

  const stop = () => {
    running?.dispose();
    running = undefined;
    starting = undefined;
    request = undefined;
    fallbackShown = undefined;
    if (fallbackNotice !== undefined) view.clearTimeout(fallbackNotice);
    fallbackNotice = undefined;
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
