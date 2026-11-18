// Reads YouTube's caption tracks in the page's MAIN world (ADR 0007). A
// track's own URL needs a proof-of-origin token only the player computes, and
// producing one would get around YouTube's restrictions, which this extension
// does not do. So the player is asked, through its own API, to show the track;
// it downloads the whole track itself, and this reads that response. The
// viewer's caption choice is put back right after.
import {
  chooseCaptionTracks,
  linesFromJson3,
  type CaptionLine,
  type CaptionTrackInfo,
  type LoadedCaptionTrack,
} from './caption-track';

export const CAPTION_MESSAGE_SOURCE = 'bilingual-read-ahead-captions';

export type ContentToCaptionTapMessage = {
  requestId: string;
  source: typeof CAPTION_MESSAGE_SOURCE;
  sourceLanguage?: string;
  targetLanguage: string;
  type: 'request';
  videoId: string;
};

export type CaptionTapToContentMessage = {
  // Absent: no caption track to use; the recognizer runs.
  original?: LoadedCaptionTrack;
  requestId: string;
  sameLanguage?: boolean;
  source: typeof CAPTION_MESSAGE_SOURCE;
  target?: LoadedCaptionTrack;
  type: 'tracks';
};

const INSTALL_KEY = '__bilingualCaptionTapInstalled';
// The isolated world gives up after 2 s (ADR 0007); this stops working
// shortly after so a late answer is never half done.
const DEADLINE_MS = 2_500;
const POLL_MS = 100;

interface YouTubeCaptionTrack {
  kind?: string;
  languageCode?: string;
  vssId?: string;
}

interface PlayerTrackOption {
  languageCode?: string;
  [key: string]: unknown;
}

interface CaptionTracklist {
  // One per audio track: the original and any dubs ('en-US.4', 'ja.10').
  audioTracks?: Array<{ audioTrackId?: string }>;
  captionTracks?: YouTubeCaptionTrack[];
  defaultAudioTrackIndex?: number;
}

interface YouTubePlayer extends HTMLElement {
  getOption?(module: string, option: string): unknown;
  getPlayerResponse?(): {
    captions?: { playerCaptionsTracklistRenderer?: CaptionTracklist };
    videoDetails?: { videoId?: string };
  } | undefined;
  loadModule?(module: string): void;
  setOption?(module: string, option: string, value: unknown): void;
}

interface Track extends CaptionTrackInfo {
  vssId?: string;
}

type TapWindow = Window & { [INSTALL_KEY]?: boolean };

type Waiter = (body: string) => void;

// The language spoken, as far as YouTube tells: its default audio track's
// language ('en-US.4' → 'en-US'), or else that of its speech-recognition track
// when there is just one. A dubbed video has a recognition track per dub, so
// "the first one" could be any of them.
export function spokenLanguageOf(tracklist: CaptionTracklist): string | undefined {
  const audio = tracklist.audioTracks?.[tracklist.defaultAudioTrackIndex ?? 0];
  const fromAudio = audio?.audioTrackId?.split('.')[0];
  if (fromAudio) return fromAudio;
  const generated = (tracklist.captionTracks ?? []).filter((track) => track.kind === 'asr');
  return generated.length === 1 ? generated[0]!.languageCode : undefined;
}

export function installCaptionTap(view: Window): void {
  const tapWindow = view as TapWindow;
  if (tapWindow[INSTALL_KEY]) return;
  tapWindow[INSTALL_KEY] = true;
  const { document } = view;
  // Track downloads waited for, by language code.
  const waiters = new Map<string, Waiter>();

  // The player downloads tracks with XMLHttpRequest. Only its responses are
  // read; the requests go out exactly as the player made them.
  const { XMLHttpRequest } = view as Window & typeof globalThis;
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    ...args: Parameters<XMLHttpRequest['open']>
  ) {
    const url = String(args[1]);
    if (url.includes('/api/timedtext')) {
      this.addEventListener('load', () => {
        try {
          const params = new URL(url, view.location.href).searchParams;
          // Machine translations and generated tracks are not caption tracks.
          if (params.has('tlang') || params.get('kind') === 'asr') return;
          const waiter = waiters.get(params.get('lang') ?? '');
          if (waiter && typeof this.responseText === 'string') waiter(this.responseText);
        } catch {
          // Not a response this reads.
        }
      });
    }
    return open.apply(this, args);
  } as XMLHttpRequest['open'];

  const sleep = (ms: number) => new Promise<void>((resolve) => view.setTimeout(resolve, ms));

  const findPlayer = async (videoId: string, deadline: number): Promise<YouTubePlayer | undefined> => {
    for (;;) {
      const player = document.getElementById('movie_player') as YouTubePlayer | null;
      if (player?.getPlayerResponse?.()?.videoDetails?.videoId === videoId) return player;
      if (Date.now() >= deadline) return undefined;
      await sleep(POLL_MS);
    }
  };

  const download = (player: YouTubePlayer, track: Track, deadline: number): Promise<CaptionLine[]> =>
    new Promise((resolve, reject) => {
      const timer = view.setTimeout(() => {
        waiters.delete(track.language);
        reject(new Error('caption_timeout'));
      }, Math.max(0, deadline - Date.now()));
      waiters.set(track.language, (body) => {
        view.clearTimeout(timer);
        waiters.delete(track.language);
        try {
          resolve(linesFromJson3(JSON.parse(body)));
        } catch {
          reject(new Error('caption_invalid'));
        }
      });
      // Choosing the track already showing downloads nothing; reloading it
      // does.
      const current = player.getOption?.('captions', 'track') as PlayerTrackOption | undefined;
      if (current?.languageCode === track.language && current.kind !== 'asr') {
        player.setOption!('captions', 'reload', true);
      } else {
        player.setOption!('captions', 'track', {
          languageCode: track.language,
          ...(track.vssId ? { vss_id: track.vssId } : {}),
        });
      }
    });

  const load = async (
    message: ContentToCaptionTapMessage,
  ): Promise<Omit<CaptionTapToContentMessage, 'requestId' | 'source' | 'type'>> => {
    const deadline = Date.now() + DEADLINE_MS;
    const player = await findPlayer(message.videoId, deadline);
    const tracklist = player?.getPlayerResponse?.()?.captions?.playerCaptionsTracklistRenderer;
    const listed = tracklist?.captionTracks;
    if (!player?.setOption || !tracklist || !Array.isArray(listed)) return {};
    const tracks: Track[] = listed
      .filter((track) => typeof track.languageCode === 'string')
      .map((track) => ({
        generated: track.kind === 'asr',
        language: track.languageCode!,
        ...(track.vssId ? { vssId: track.vssId } : {}),
      }));
    const spokenLanguage = spokenLanguageOf(tracklist);
    const choice = chooseCaptionTracks(tracks, {
      ...(message.sourceLanguage ? { sourceLanguage: message.sourceLanguage } : {}),
      ...(spokenLanguage ? { spokenLanguage } : {}),
      targetLanguage: message.targetLanguage,
    });
    if (!choice) return {};

    const previous = player.getOption?.('captions', 'track') as PlayerTrackOption | undefined;
    player.loadModule?.('captions');
    try {
      const original = await download(player, choice.original, deadline);
      if (original.length === 0) return {};
      // A target track that fails to load still leaves the original: the
      // translator does the rest.
      const target = choice.target
        ? await download(player, choice.target, deadline).catch(() => undefined)
        : undefined;
      return {
        original: { language: choice.original.language, lines: original },
        sameLanguage: choice.sameLanguage,
        ...(choice.target && target?.length
          ? { target: { language: choice.target.language, lines: target } }
          : {}),
      };
    } catch {
      return {};
    } finally {
      // Put the viewer's caption choice back: their track, or captions off.
      player.setOption('captions', 'track', previous?.languageCode ? previous : {});
    }
  };

  view.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== view) return;
    const message = event.data as Partial<ContentToCaptionTapMessage> | null;
    if (message?.source !== CAPTION_MESSAGE_SOURCE || message.type !== 'request') return;
    if (typeof message.videoId !== 'string' || typeof message.requestId !== 'string' ||
      typeof message.targetLanguage !== 'string') return;
    void load(message as ContentToCaptionTapMessage).then((result) => {
      const reply: CaptionTapToContentMessage = {
        ...result,
        requestId: message.requestId!,
        source: CAPTION_MESSAGE_SOURCE,
        type: 'tracks',
      };
      view.postMessage(reply, view.location.origin);
    });
  });
}
