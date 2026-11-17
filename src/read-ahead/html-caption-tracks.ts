// Caption tracks of an ordinary HTML5 video (ADR 0003): its <track> elements,
// read through video.textTracks. A track the page cannot read (another origin
// without CORS) never loads, and counts as absent.
import {
  chooseCaptionTracks,
  cleanLine,
  type CaptionLine,
  type CaptionTrackInfo,
  type LoadedCaptionTracks,
} from './caption-track';

const POLL_MS = 100;
const TRACK_LOADED = 2;
const TRACK_ERROR = 3;

interface HtmlTrack extends CaptionTrackInfo {
  element?: HTMLTrackElement;
  track: TextTrack;
}

function cueText(cue: TextTrackCue): string {
  const vtt = cue as VTTCue;
  if (typeof vtt.getCueAsHTML === 'function') return cleanLine(vtt.getCueAsHTML().textContent ?? '');
  return cleanLine(String(vtt.text ?? '').replace(/<[^>]*>/g, ''));
}

async function readCues(entry: HtmlTrack, deadline: number): Promise<CaptionLine[]> {
  const { track, element } = entry;
  const mode = track.mode;
  // A disabled track never loads its cues; hidden loads them without showing.
  if (mode === 'disabled') track.mode = 'hidden';
  try {
    for (;;) {
      const state = element?.readyState;
      if (state === TRACK_LOADED || state === TRACK_ERROR || Date.now() >= deadline) break;
      // A track added from script has no element to report its state.
      if (state === undefined && (track.cues?.length ?? 0) > 0) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    return Array.from(track.cues ?? [])
      .map((cue) => ({ end: cue.endTime, start: cue.startTime, text: cueText(cue) }))
      .filter((line) => line.text)
      .sort((a, b) => a.start - b.start);
  } finally {
    track.mode = mode;
  }
}

export async function loadHtmlCaptionTracks(
  video: HTMLVideoElement,
  languages: { sourceLanguage?: string; targetLanguage: string },
  timeoutMs: number,
): Promise<LoadedCaptionTracks | undefined> {
  const deadline = Date.now() + timeoutMs;
  const elements = Array.from(video.querySelectorAll('track'));
  const tracks: HtmlTrack[] = Array.from(video.textTracks)
    .filter((track) => (track.kind === 'subtitles' || track.kind === 'captions') && track.language)
    .map((track) => {
      const element = elements.find((item) => item.track === track);
      return { generated: false, language: track.language, track, ...(element ? { element } : {}) };
    });
  // A plain video does not say what is spoken; its default track is the best
  // guess when the viewer left the source on "detect".
  const spokenLanguage = tracks.find((entry) => entry.element?.default)?.language;
  const choice = chooseCaptionTracks(tracks, {
    ...languages,
    ...(spokenLanguage ? { spokenLanguage } : {}),
  });
  if (!choice) return undefined;
  const original = await readCues(choice.original, deadline);
  if (original.length === 0) return undefined;
  const target = choice.target ? await readCues(choice.target, deadline) : [];
  return {
    original: { language: choice.original.language, lines: original },
    sameLanguage: choice.sameLanguage,
    site: 'video',
    ...(choice.target && target.length > 0
      ? { target: { language: choice.target.language, lines: target } }
      : {}),
  };
}
