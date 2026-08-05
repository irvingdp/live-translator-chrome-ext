export interface TranscriptEvent {
  isFinal: boolean;
  revision: number;
  segmentId: string;
  text: string;
}

export interface TranslationPhrase extends TranscriptEvent {
  mode?: 'replace';
}

export interface StabilizedTranscriptUpdate {
  originalText: string;
  translation?: TranslationPhrase;
}

interface SegmentState {
  emittedText: string;
  lastRevision: number;
  lastText: string;
}

function longestCommonPrefix(left: string, right: string): string {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return left.slice(0, index);
}

function stableBoundary(previous: string, current: string): string {
  const common = longestCommonPrefix(previous, current);
  if (!common) return '';

  const nextCharacter = current.at(common.length);
  if (
    common.length === previous.length &&
    (nextCharacter === undefined || /[\s\p{P}]/u.test(nextCharacter))
  ) {
    return common.trim();
  }

  const containsWhitespace = /\s/u.test(common);
  if (!containsWhitespace) return common;

  return common.slice(0, common.lastIndexOf(' ')).trim();
}

function untranslatedSuffix(fullText: string, emittedText: string): string {
  if (!emittedText) return fullText.trim();
  if (!fullText.startsWith(emittedText)) return fullText.trim();
  return fullText.slice(emittedText.length).trim();
}

export class TranscriptStabilizer {
  private readonly segments = new Map<string, SegmentState>();
  private readonly finalizedRevisions = new Map<string, number>();

  ingest(event: TranscriptEvent): StabilizedTranscriptUpdate | undefined {
    const finalizedRevision = this.finalizedRevisions.get(event.segmentId);
    if (finalizedRevision !== undefined && event.revision <= finalizedRevision) {
      return undefined;
    }

    const existing = this.segments.get(event.segmentId);
    if (existing && event.revision <= existing.lastRevision) return undefined;

    const state: SegmentState = existing ?? {
      emittedText: '',
      lastRevision: 0,
      lastText: '',
    };

    const stableText = event.isFinal
      ? event.text.trim()
      : stableBoundary(state.lastText, event.text);
    const phrase = untranslatedSuffix(stableText, state.emittedText);
    const replacesEmittedText =
      Boolean(state.emittedText) && !stableText.startsWith(state.emittedText);

    state.lastRevision = event.revision;
    state.lastText = event.text;
    if (phrase) state.emittedText = stableText;
    this.segments.set(event.segmentId, state);

    const update: StabilizedTranscriptUpdate = { originalText: event.text };
    if (phrase) {
      update.translation = {
        isFinal: event.isFinal,
        ...(replacesEmittedText ? { mode: 'replace' as const } : {}),
        revision: event.revision,
        segmentId: event.segmentId,
        text: phrase,
      };
    }

    if (event.isFinal) {
      this.segments.delete(event.segmentId);
      this.finalizedRevisions.set(event.segmentId, event.revision);
    }
    return update;
  }
}
