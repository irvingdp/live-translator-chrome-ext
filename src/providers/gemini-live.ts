import type { CaptionPairUpdate } from '../audio/offscreen-capture-controller';
import { isWideCharacter, splitIntoSentences } from '../core/caption-chunker';
import { t } from '../core/i18n';

export const GEMINI_MODEL = 'models/gemini-3.5-live-translate-preview';

const GEMINI_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

// Live Translate speaks its translation, so audio is the only response modality
// it offers. The spoken output is discarded; the text we render arrives as the
// transcription of it.
export function buildGeminiSetupMessage(
  targetLanguage: string,
  resumptionHandle?: string,
): string {
  return JSON.stringify({
    setup: {
      generationConfig: {
        responseModalities: ['AUDIO'],
        translationConfig: {
          // Staying silent on audio already in the target language keeps the
          // caption from echoing the source line back as its own translation.
          echoTargetLanguage: false,
          targetLanguageCode: targetLanguage,
        },
      },
      inputAudioTranscription: {},
      model: GEMINI_MODEL,
      outputAudioTranscription: {},
      sessionResumption: resumptionHandle ? { handle: resumptionHandle } : {},
    },
  });
}

// The browser WebSocket cannot set headers, so the key travels as a query
// parameter — the only auth the Live API offers a page.
export function buildGeminiUrl(apiKey: string): string {
  return `${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
}

export function buildGeminiAudioMessage(audio: ArrayBuffer): string {
  return JSON.stringify({
    realtimeInput: {
      audio: {
        data: bytesToBase64(new Uint8Array(audio)),
        mimeType: 'audio/pcm;rate=16000',
      },
    },
  });
}

// Chunked because String.fromCharCode takes its bytes as arguments, and a whole
// second of PCM16 would blow past the argument limit.
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

// Chrome hands this endpoint's frames over as Blobs even though every payload
// is UTF-8 JSON, so a handler that accepts only strings silently discards the
// entire conversation — including setupComplete.
// Every branch is duck-typed rather than an `instanceof`: a frame can reach
// this code from another realm, where `instanceof Blob` is false for a Blob,
// and a missed frame is not a dropped word but a dropped session.
export async function readSocketFrame(
  data: unknown,
): Promise<string | undefined> {
  if (typeof data === 'string') return data;
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') {
    return new TextDecoder().decode(data as ArrayBuffer);
  }
  if (typeof (data as Blob | undefined)?.text === 'function') {
    return (data as Blob).text();
  }
  return undefined;
}

export type GeminiEvent =
  | { handle: string; type: 'resumption' }
  | { message: string; type: 'error' }
  | {
      original?: string;
      translation?: string;
      turnComplete: boolean;
      type: 'serverContent';
    }
  | { type: 'goAway' }
  | { type: 'setupComplete' };

function textOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const text = (value as { text?: unknown }).text;
  return typeof text === 'string' ? text : undefined;
}

// One frame can carry more than one thing worth acting on, so this returns
// every event it recognises rather than the first.
export function parseGeminiMessage(raw: string): GeminiEvent[] {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!message || typeof message !== 'object') return [];

  const events: GeminiEvent[] = [];
  const error = message.error as { message?: unknown } | undefined;
  if (error) {
    events.push({
      message:
        typeof error.message === 'string' ? error.message : t('geminiApiError'),
      type: 'error',
    });
  }
  if (message.setupComplete) events.push({ type: 'setupComplete' });
  const resumption = message.sessionResumptionUpdate as
    | { newHandle?: unknown }
    | undefined;
  if (typeof resumption?.newHandle === 'string' && resumption.newHandle) {
    events.push({ handle: resumption.newHandle, type: 'resumption' });
  }
  if (message.goAway) events.push({ type: 'goAway' });

  const content = message.serverContent as Record<string, unknown> | undefined;
  if (content) {
    const original = textOf(content.inputTranscription);
    const translation = textOf(content.outputTranscription);
    const turnComplete = Boolean(content.turnComplete);
    if (original !== undefined || translation !== undefined || turnComplete) {
      events.push({ original, translation, turnComplete, type: 'serverContent' });
    }
  }
  return events;
}

export type GeminiCloseDecision =
  | { code: string; retry: false }
  | { delayMs: number; retry: true };

const FATAL_REASON = /api key|api_key|unauthenticated|permission|auth/i;
const QUOTA_REASON = /quota|rate limit|resource[ _]exhausted/i;
const CONFIG_REASON = /invalid argument|model not found|not supported/i;

// Reasons the server will keep giving us for as long as we keep asking, so
// retrying only delays telling the user what to fix.
export function classifyGeminiClose({
  attempt,
  code,
  maxAttempts,
  reason,
}: {
  attempt: number;
  code: number;
  maxAttempts: number;
  reason: string;
}): GeminiCloseDecision {
  if (QUOTA_REASON.test(reason) || code === 4429) {
    return { code: 'gemini_quota_exceeded', retry: false };
  }
  if (FATAL_REASON.test(reason) || [4001, 4003, 4401, 4403].includes(code)) {
    return { code: 'gemini_invalid_credentials', retry: false };
  }
  if (CONFIG_REASON.test(reason) || code === 1008) {
    return { code: 'gemini_unavailable', retry: false };
  }
  if (attempt >= maxAttempts) return { code: 'gemini_disconnected', retry: false };
  return { delayMs: Math.min(8_000, 500 * 2 ** attempt), retry: true };
}

interface SentenceUpdate {
  index: number;
  isClosed: boolean;
  text: string;
}

// Live transcription is mostly delivered as either cumulative text or clean
// append-only fragments, but Gemini occasionally revises the tail by sending a
// fragment whose beginning repeats text already near the end of the open
// sentence. Appending that frame creates a phantom source row and shifts every
// later translation by one. Replace from the longest repeated prefix instead.
function mergeOverlappingFragment(previous: string, fragment: string): string {
  if (!previous || !fragment) return previous + fragment;
  const trimmed = fragment.trimStart();
  if (!trimmed) return previous;
  const haystack = previous.toLocaleLowerCase();
  const needle = trimmed.toLocaleLowerCase();
  const searchFrom = Math.max(
    0,
    previous.length - 240,
    Math.floor(previous.length * 0.45),
  );
  const longest = Math.min(needle.length, 120);
  for (let length = longest; length >= 8; length -= 1) {
    const prefix = needle.slice(0, length);
    const index = haystack.lastIndexOf(prefix);
    if (index < searchFrom) continue;
    const before = previous[index - 1];
    if (before && /[\p{L}\p{N}]/u.test(before)) continue;
    return previous.slice(0, index) + trimmed;
  }
  return previous + fragment;
}

// One of Gemini's two independent transcription streams. It accepts both the
// cumulative updates used by Live Translate and fragment updates used by other
// Live models, then consumes every frozen sentence so a long turn retains only
// its still-editable tail.
class SentenceStream {
  private consumed = 0;
  private mode: 'cumulative' | 'fragment' | 'unknown' = 'unknown';
  private nextIndex = 0;
  private openText = '';
  private text = '';

  ingest(next: string, _maxWidth: number): SentenceUpdate[] {
    const tail =
      next.length >= this.consumed ? next.slice(this.consumed) : undefined;
    const previous = this.text;
    if (this.mode === 'cumulative') {
      // A revision that reaches into an already-frozen prefix cannot safely
      // rewrite rows the viewer has read. Ignore that frame rather than
      // appending the provider's full cumulative text as a new fragment.
      if (tail === undefined) return [];
      this.text = tail;
    } else if (this.mode === 'fragment') {
      this.text = mergeOverlappingFragment(this.text, next);
    } else if (tail !== undefined && this.looksCumulative(previous, tail)) {
      this.text = tail;
      if (previous) this.mode = 'cumulative';
    } else {
      this.text = mergeOverlappingFragment(this.text, next);
      if (previous) this.mode = 'fragment';
    }
    return this.segment(false);
  }

  finalize(_maxWidth: number): SentenceUpdate[] {
    return this.segment(true);
  }

  reset(): void {
    this.consumed = 0;
    this.mode = 'unknown';
    this.nextIndex = 0;
    this.openText = '';
    this.text = '';
  }

  private looksCumulative(previous: string, next: string): boolean {
    if (!previous || next.startsWith(previous) || previous.startsWith(next)) {
      return true;
    }
    let common = 0;
    const limit = Math.min(previous.length, next.length);
    while (common < limit && previous[common] === next[common]) common += 1;
    // Once a few leading characters agree, replacement is much more likely
    // than a fragment that coincidentally repeats the open sentence's prefix.
    return common >= 3;
  }

  private segment(isFinal: boolean): SentenceUpdate[] {
    const spans = splitIntoSentences(this.text);
    const freezeUntil = isFinal
      ? spans.length
      : Math.max(spans.length - 1, 0);
    const updates: SentenceUpdate[] = [];
    let droppedEnd = 0;

    for (let index = 0; index < freezeUntil; index += 1) {
      const span = spans[index]!;
      updates.push({
        index: this.nextIndex,
        isClosed: true,
        text: span.text,
      });
      this.nextIndex += 1;
      droppedEnd = span.end;
    }

    if (droppedEnd > 0) {
      this.consumed += droppedEnd;
      this.text = this.text.slice(droppedEnd);
      this.openText = '';
    }

    if (isFinal) {
      // Consume trailing whitespace as well, keeping the cumulative provider
      // offset aligned if it sent a final update ending in spaces.
      this.consumed += this.text.length;
      this.text = '';
      this.openText = '';
      return updates;
    }

    const open = spans[freezeUntil]?.text ?? '';
    if (open && open !== this.openText) {
      this.openText = open;
      updates.push({
        index: this.nextIndex,
        isClosed: false,
        text: open,
      });
    }
    return updates;
  }
}

interface TranslationSentence {
  isClosed: boolean;
  text: string;
}

const MAX_RETAINED_TRANSLATION_CHARACTERS = 2_000;

function joinSentenceParts(parts: string[]): string {
  let result = '';
  for (const part of parts) {
    if (!result) {
      result = part;
      continue;
    }
    const previous = Array.from(result).at(-1)!;
    const next = Array.from(part)[0]!;
    result +=
      isWideCharacter(previous) || isWideCharacter(next) ? part : ` ${part}`;
  }
  return result;
}

// Converts Gemini's independently-timed source and target streams into stable
// bilingual rows. A target sentence locks to the newest source row that exists
// when it first appears; its later revisions keep that assignment. One bad
// source split can therefore leave one untranslated row, but cannot shift all
// subsequent translations.
export class GeminiCaptionAccumulator {
  private maxLineWidth: number;
  private readonly original = new SentenceStream();
  private pendingRollover = false;
  private sourceCount = 0;
  private readonly translation = new SentenceStream();
  private readonly translationAssignments = new Map<number, number>();
  private readonly translationPrefixes = new Map<number, string>();
  private readonly translations = new Map<number, TranslationSentence>();
  private turnIndex = 0;

  constructor(maxLineWidth = 90) {
    this.maxLineWidth = maxLineWidth;
  }

  setMaxLineWidth(maxLineWidth: number): void {
    if (Number.isFinite(maxLineWidth) && maxLineWidth > 0) {
      this.maxLineWidth = maxLineWidth;
    }
  }

  ingest(event: {
    original?: string;
    translation?: string;
    turnComplete: boolean;
  }): CaptionPairUpdate[] {
    const pending = new Map<string, CaptionPairUpdate>();
    if (event.original !== undefined) {
      if (this.pendingRollover) {
        this.rollover(pending);
      }
      this.acceptOriginal(
        this.original.ingest(event.original, this.maxLineWidth),
        pending,
      );
    }
    if (event.translation !== undefined) {
      this.acceptTranslation(
        this.translation.ingest(event.translation, this.maxLineWidth),
        pending,
      );
    }
    if (event.turnComplete) {
      this.acceptOriginal(
        this.original.finalize(this.maxLineWidth),
        pending,
      );
      this.pendingRollover = true;
    }
    return [...pending.values()];
  }

  // A reconnect resumes the session but not its interrupted source utterance.
  // Translation remains open until the next source arrives so output frames
  // already in flight can still finish the previous bilingual row.
  closeTurn(): CaptionPairUpdate[] {
    const pending = new Map<string, CaptionPairUpdate>();
    this.acceptOriginal(this.original.finalize(this.maxLineWidth), pending);
    this.pendingRollover = true;
    return [...pending.values()];
  }

  private acceptOriginal(
    updates: SentenceUpdate[],
    pending: Map<string, CaptionPairUpdate>,
  ): void {
    for (const update of updates) {
      this.sourceCount = Math.max(this.sourceCount, update.index + 1);
      this.queue(pending, update.index, { original: update.text });
    }
    this.assignWaitingTranslations(pending);
    this.compactAssignedTranslations();
    this.trimTranslations();
  }

  private acceptTranslation(
    updates: SentenceUpdate[],
    pending: Map<string, CaptionPairUpdate>,
  ): void {
    for (const update of updates) {
      this.translations.set(update.index, {
        isClosed: update.isClosed,
        text: update.text,
      });
      let sourceIndex = this.translationAssignments.get(update.index);
      if (sourceIndex === undefined && this.sourceCount > 0) {
        sourceIndex = this.sourceCount - 1;
        this.translationAssignments.set(update.index, sourceIndex);
      }
      if (sourceIndex !== undefined) {
        this.emitAssignedTranslation(sourceIndex, pending);
      }
    }
    this.compactAssignedTranslations();
    this.trimTranslations();
  }

  private assignWaitingTranslations(
    pending: Map<string, CaptionPairUpdate>,
  ): void {
    if (this.sourceCount === 0) return;
    const latestSourceIndex = this.sourceCount - 1;
    let assigned = false;
    for (const targetIndex of this.translations.keys()) {
      if (this.translationAssignments.has(targetIndex)) continue;
      this.translationAssignments.set(targetIndex, latestSourceIndex);
      assigned = true;
    }
    if (assigned) this.emitAssignedTranslation(latestSourceIndex, pending);
  }

  private emitAssignedTranslation(
    sourceIndex: number,
    pending: Map<string, CaptionPairUpdate>,
  ): void {
    const prefix = this.translationPrefixes.get(sourceIndex);
    const parts = [...this.translations.entries()]
      .filter(
        ([targetIndex]) =>
          this.translationAssignments.get(targetIndex) === sourceIndex,
      )
      .sort(([left], [right]) => left - right)
      .map(([, sentence]) => sentence.text);
    if (prefix) parts.unshift(prefix);
    if (parts.length === 0) return;
    this.queue(pending, sourceIndex, {
      translation: joinSentenceParts(parts),
    });
  }

  private compactAssignedTranslations(): void {
    for (const [targetIndex, sentence] of this.translations) {
      if (!sentence.isClosed) continue;
      const sourceIndex = this.translationAssignments.get(targetIndex);
      if (sourceIndex === undefined) continue;
      const previous = this.translationPrefixes.get(sourceIndex);
      this.translationPrefixes.set(
        sourceIndex,
        joinSentenceParts(
          previous ? [previous, sentence.text] : [sentence.text],
        ),
      );
      this.translations.delete(targetIndex);
      this.translationAssignments.delete(targetIndex);
    }
  }

  private queue(
    pending: Map<string, CaptionPairUpdate>,
    index: number,
    update: Omit<CaptionPairUpdate, 'id'>,
  ): void {
    const id = `turn-${this.turnIndex}#${index}`;
    pending.set(id, { ...pending.get(id), ...update, id });
  }

  private rollover(pending: Map<string, CaptionPairUpdate>): void {
    this.acceptTranslation(
      this.translation.finalize(this.maxLineWidth),
      pending,
    );
    this.pendingRollover = false;
    this.sourceCount = 0;
    this.translationAssignments.clear();
    this.translationPrefixes.clear();
    this.translations.clear();
    this.turnIndex += 1;
    this.original.reset();
    this.translation.reset();
  }

  private trimTranslations(): void {
    let retained = [...this.translations.values()].reduce(
      (total, sentence) => total + sentence.text.length,
      0,
    );
    for (const [index, sentence] of this.translations) {
      if (retained <= MAX_RETAINED_TRANSLATION_CHARACTERS) break;
      if (this.translationAssignments.has(index)) continue;
      this.translations.delete(index);
      retained -= sentence.text.length;
    }
  }
}
