import type { CaptionPairUpdate } from '../audio/offscreen-capture-controller';
import { isWideCharacter, splitIntoUnits } from '../core/caption-chunker';
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

  ingest(next: string, maxWidth: number): SentenceUpdate[] {
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
      this.text += next;
    } else if (tail !== undefined && this.looksCumulative(previous, tail)) {
      this.text = tail;
      if (previous) this.mode = 'cumulative';
    } else {
      this.text += next;
      if (previous) this.mode = 'fragment';
    }
    return this.segment(maxWidth, false);
  }

  finalize(maxWidth: number): SentenceUpdate[] {
    return this.segment(maxWidth, true);
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

  private segment(maxWidth: number, isFinal: boolean): SentenceUpdate[] {
    const spans = splitIntoUnits(this.text, maxWidth);
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
// bilingual sentence rows. Source sentences establish rows; target-only
// updates are cached so a late translation cannot resurrect an evicted row.
export class GeminiCaptionAccumulator {
  private maxLineWidth: number;
  private readonly original = new SentenceStream();
  private pendingRollover = false;
  private sourceCount = 0;
  private sourceFinal = false;
  private readonly translation = new SentenceStream();
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
      this.sourceFinal = true;
      this.pendingRollover = true;
      this.emitTranslationTail(pending);
    }
    return [...pending.values()];
  }

  // A reconnect resumes the session but not its interrupted source utterance.
  // Translation remains open until the next source arrives so output frames
  // already in flight can still finish the previous bilingual row.
  closeTurn(): CaptionPairUpdate[] {
    const pending = new Map<string, CaptionPairUpdate>();
    this.acceptOriginal(this.original.finalize(this.maxLineWidth), pending);
    this.sourceFinal = true;
    this.pendingRollover = true;
    this.emitTranslationTail(pending);
    return [...pending.values()];
  }

  private acceptOriginal(
    updates: SentenceUpdate[],
    pending: Map<string, CaptionPairUpdate>,
  ): void {
    for (const update of updates) {
      this.sourceCount = Math.max(this.sourceCount, update.index + 1);
      this.queue(pending, update.index, { original: update.text });
      const translated = this.translations.get(update.index);
      if (translated) {
        this.queue(pending, update.index, { translation: translated.text });
      }
    }
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
      if (this.sourceFinal) {
        if (update.index < this.sourceCount - 1) {
          this.queue(pending, update.index, { translation: update.text });
        } else {
          this.emitTranslationTail(pending);
        }
      } else if (update.index < this.sourceCount) {
        this.queue(pending, update.index, { translation: update.text });
      }
    }
    this.trimTranslations();
  }

  private emitTranslationTail(
    pending: Map<string, CaptionPairUpdate>,
  ): void {
    if (this.sourceCount === 0) return;
    const lastSourceIndex = this.sourceCount - 1;
    const tail = [...this.translations.entries()]
      .filter(([index]) => index >= lastSourceIndex)
      .sort(([left], [right]) => left - right)
      .map(([, sentence]) => sentence.text);
    if (tail.length > 0) {
      this.queue(pending, lastSourceIndex, {
        translation: joinSentenceParts(tail),
      });
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
    this.emitTranslationTail(pending);
    this.pendingRollover = false;
    this.sourceCount = 0;
    this.sourceFinal = false;
    this.translations.clear();
    this.turnIndex += 1;
    this.original.reset();
    this.translation.reset();
  }

  private trimTranslations(): void {
    // Once the source advances, only its latest sentence can still become the
    // merged tail. Older closed translations have already reached their rows.
    for (const [index, sentence] of this.translations) {
      if (index < this.sourceCount - 1 && sentence.isClosed) {
        this.translations.delete(index);
      }
    }
    let retained = [...this.translations.values()].reduce(
      (total, sentence) => total + sentence.text.length,
      0,
    );
    for (const [index, sentence] of this.translations) {
      if (retained <= MAX_RETAINED_TRANSLATION_CHARACTERS) break;
      if (index < this.sourceCount) continue;
      this.translations.delete(index);
      retained -= sentence.text.length;
    }
  }
}
