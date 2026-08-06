export interface TranscriptEvent {
  isFinal: boolean;
  revision: number;
  segmentId: string;
  text: string;
}

export interface StabilizedTranscriptUpdate {
  originalText: string;
  stableText: string;
}

interface SegmentState {
  lastRevision: number;
  lastText: string;
  stableText: string;
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
      lastRevision: 0,
      lastText: '',
      stableText: '',
    };
    const candidate = event.isFinal
      ? event.text.trim()
      : stableBoundary(state.lastText, event.text);

    state.lastRevision = event.revision;
    state.lastText = event.text;
    state.stableText = event.isFinal
      ? candidate
      : candidate.length > state.stableText.length
        ? candidate
        : state.stableText;
    this.segments.set(event.segmentId, state);

    const update: StabilizedTranscriptUpdate = {
      originalText: event.text,
      stableText: state.stableText,
    };

    if (event.isFinal) {
      this.segments.delete(event.segmentId);
      this.finalizedRevisions.set(event.segmentId, event.revision);
    }
    return update;
  }
}
