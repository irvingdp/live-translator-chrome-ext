// Caption tracks (GLOSSARY.md, ADR 0003): timed captions the uploader
// published with the video. Read-ahead reads its sentences from one in the
// spoken language instead of a recognizer, and its translations from one in
// the target language instead of a translator. Everything here is plain data
// shaping, shared by the YouTube page-world reader and the isolated world.
import { SENTENCE_END, joinWords } from './groq-transcription';

// A caption track as listed by the site, before its lines are loaded.
export interface CaptionTrackInfo {
  // Site-generated speech recognition (YouTube's "自動產生"): not a caption
  // track in the glossary's sense, but its language tells what is spoken.
  generated: boolean;
  // BCP-47, as the site names it ('en', 'zh-TW', 'iw').
  language: string;
}

// One caption line, in media seconds.
export interface CaptionLine {
  end: number;
  start: number;
  text: string;
}

export interface CaptionSentence {
  end: number;
  original: string;
  start: number;
}

// A caption track with its lines loaded.
export interface LoadedCaptionTrack {
  language: string;
  lines: CaptionLine[];
}

// What read-ahead found for a video: an original track, and a target-language
// one when there is one.
export interface LoadedCaptionTracks {
  original: LoadedCaptionTrack;
  sameLanguage: boolean;
  // Where the tracks came from, for the notice ("使用 YouTube 字幕").
  site: 'video' | 'youtube';
  target?: LoadedCaptionTrack;
}

export interface CaptionTrackChoice<Track extends CaptionTrackInfo> {
  original: Track;
  // The original is already in the target language: nothing to translate.
  sameLanguage: boolean;
  // An uploader track in the target language, when there is one.
  target?: Track;
}

// A sentence is closed at its sentence ender, or before it would pass this
// long without one.
export const MAX_SENTENCE_SECONDS = 15;
// Silence this long between two lines ends a sentence too: the uploader
// stopped mid-thought, or the next line is someone else.
const MAX_LINE_GAP_SECONDS = 2;
// A translation line overlapping no sentence goes to the nearest one within
// this distance, or is dropped.
const NEAREST_SENTENCE_SECONDS = 1;

// Old codes some sites still use, by their current names.
const LANGUAGE_ALIASES: Record<string, string> = { in: 'id', iw: 'he', jw: 'jv', no: 'nb' };
const TRADITIONAL_CHINESE_REGIONS = new Set(['hk', 'mo', 'tw']);
// The extension's languages name only the script ('zh-Hant'); among several
// tracks in it, these are its usual written form (Taiwan's, not Hong Kong's
// Cantonese-flavoured one).
const PREFERRED_CHINESE: Record<string, string[]> = {
  'zh-hans': ['zh-cn', 'zh-hans'],
  'zh-hant': ['zh-tw', 'zh-hant'],
};

// The language as compared here: aliases resolved, Chinese reduced to its
// script ('zh-Hant', 'zh-Hans'), or plain 'zh' when the code does not say.
function canonical(code: string): { base: string; full: string } {
  const parts = code.trim().replace(/_/g, '-').toLowerCase().split('-');
  const base = LANGUAGE_ALIASES[parts[0]!] ?? parts[0]!;
  if (base === 'zh') {
    const rest = parts.slice(1);
    if (rest.includes('hant') || rest.some((part) => TRADITIONAL_CHINESE_REGIONS.has(part))) {
      return { base, full: 'zh-hant' };
    }
    if (rest.length > 0) return { base, full: 'zh-hans' };
    return { base, full: 'zh' };
  }
  return { base, full: [base, ...parts.slice(1)].join('-') };
}

function rawCode(code: string): string {
  return code.trim().replace(/_/g, '-').toLowerCase();
}

// How well a track's language serves the wanted one: 4 the very code ('zh-HK'
// for 'zh-HK'), 3 the usual form of a Chinese named by script only ('zh-TW'
// for 'zh-Hant'), 2 the same language, 1 the same in another region, 0 not at
// all. Chinese in the other script is not the same language for reading.
export function languageMatch(trackLanguage: string, wanted: string): 0 | 1 | 2 | 3 | 4 {
  const track = canonical(trackLanguage);
  const want = canonical(wanted);
  if (track.base !== want.base) return 0;
  if (rawCode(trackLanguage) === rawCode(wanted)) return 4;
  if (track.full === want.full) {
    return PREFERRED_CHINESE[rawCode(wanted)]?.includes(rawCode(trackLanguage)) ? 3 : 2;
  }
  if (track.base === 'zh' && track.full !== 'zh' && want.full !== 'zh') return 0;
  return 1;
}

// A track's language as the extension's own (Gemini-style) code, which the
// translators take: 'iw' → 'he', 'zh-TW' → 'zh-Hant', 'en-GB' → 'en'.
export function languageCodeOf(trackLanguage: string): string {
  const { base, full } = canonical(trackLanguage);
  if (full === 'zh-hant') return 'zh-Hant';
  if (full === 'zh-hans') return 'zh-Hans';
  if (full === 'pt-br') return 'pt-BR';
  if (full === 'pt-pt') return 'pt-PT';
  return base;
}

function bestTrack<Track extends CaptionTrackInfo>(
  tracks: Track[],
  wanted: string,
): Track | undefined {
  let best: Track | undefined;
  let bestScore = 0;
  for (const track of tracks) {
    const score = languageMatch(track.language, wanted);
    if (score > bestScore) {
      best = track;
      bestScore = score;
    }
  }
  return best;
}

// Which tracks read-ahead uses, or undefined when there is no original track
// and the recognizer runs as before (ADR 0003). `spokenLanguage` is what the
// site says is spoken, used when the viewer left the source on "detect".
export function chooseCaptionTracks<Track extends CaptionTrackInfo>(
  tracks: Track[],
  languages: { sourceLanguage?: string; spokenLanguage?: string; targetLanguage: string },
): CaptionTrackChoice<Track> | undefined {
  const spoken = languages.sourceLanguage ?? languages.spokenLanguage;
  if (!spoken) return undefined;
  const uploaded = tracks.filter((track) => !track.generated);
  const original = bestTrack(uploaded, spoken);
  if (!original) return undefined;
  if (languageMatch(original.language, languages.targetLanguage) > 0) {
    return { original, sameLanguage: true };
  }
  const target = bestTrack(uploaded.filter((track) => track !== original), languages.targetLanguage);
  return { original, sameLanguage: false, ...(target ? { target } : {}) };
}

// YouTube's json3 caption format: events with a start, a duration and text
// pieces; a line break inside an event is just the caption's wrapping.
export function linesFromJson3(body: unknown): CaptionLine[] {
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) return [];
  const lines: CaptionLine[] = [];
  for (const event of events as Array<Record<string, unknown>>) {
    if (!Array.isArray(event.segs) || typeof event.tStartMs !== 'number') continue;
    const text = (event.segs as Array<{ utf8?: unknown }>)
      .map((segment) => (typeof segment.utf8 === 'string' ? segment.utf8 : ''))
      .join('');
    const line = cleanLine(text);
    if (!line) continue;
    const start = event.tStartMs / 1000;
    const duration = typeof event.dDurationMs === 'number' ? event.dDurationMs / 1000 : 0;
    lines.push({ end: start + duration, start, text: line });
  }
  return lines.sort((a, b) => a.start - b.start);
}

// One line of caption text: wrapping and runs of spaces become one space.
export function cleanLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// Consecutive lines joined into sentences (ADR 0003): up to a sentence ender,
// a gap in speech, or MAX_SENTENCE_SECONDS.
export function sentencesFromLines(lines: CaptionLine[]): CaptionSentence[] {
  const sentences: CaptionSentence[] = [];
  let pending: CaptionLine[] = [];
  const close = () => {
    if (pending.length === 0) return;
    sentences.push({
      end: Math.max(...pending.map((line) => line.end)),
      original: joinWords(pending.map((line) => line.text)),
      start: pending[0]!.start,
    });
    pending = [];
  };
  for (const line of lines) {
    const last = pending.at(-1);
    if (last && (
      line.start - last.end > MAX_LINE_GAP_SECONDS ||
      line.end - pending[0]!.start > MAX_SENTENCE_SECONDS
    )) {
      close();
    }
    pending.push(line);
    if (SENTENCE_END.test(line.text)) close();
  }
  close();
  return sentences;
}

function overlap(a: { end: number; start: number }, b: { end: number; start: number }): number {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start);
}

// Each sentence's translation: the target-language lines that overlap it more
// than any other sentence, in order (ADR 0003). Every line is used once.
export function pairTranslations(sentences: CaptionSentence[], lines: CaptionLine[]): string[] {
  const pieces: string[][] = sentences.map(() => []);
  for (const line of lines) {
    let best = -1;
    let bestOverlap = 0;
    let nearest = -1;
    let nearestDistance = NEAREST_SENTENCE_SECONDS;
    sentences.forEach((sentence, index) => {
      const shared = overlap(sentence, line);
      if (shared > bestOverlap) {
        best = index;
        bestOverlap = shared;
      } else if (shared <= 0 && -shared <= nearestDistance) {
        nearest = index;
        nearestDistance = -shared;
      }
    });
    const chosen = best >= 0 ? best : nearest;
    if (chosen >= 0) pieces[chosen]!.push(line.text);
  }
  return pieces.map((texts) => joinWords(texts));
}
