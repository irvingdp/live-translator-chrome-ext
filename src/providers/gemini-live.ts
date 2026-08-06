import type { CaptionPairEvent } from '../audio/offscreen-capture-controller';
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

// A turn stays open for as long as the speaker keeps talking, so its text is
// unbounded. Only the tail is ever on screen, but the whole row is re-sent to
// the tab on every update, so an uncapped turn turns into ever-larger messages
// several times a second. Far more than three rows of caption could hold, so
// the discarded end is never visible and needs no word boundary.
const MAX_RETAINED_CHARACTERS = 2_000;

// One of the two transcription streams of the open turn.
class TurnStream {
  private consumed = 0;
  private text = '';

  // Live Translate sends the turn's text cumulatively; other Live models send
  // fragments to append. Comparing against what is kept, offset by what was
  // dropped, recognises both without having to keep the dropped prefix — and
  // picks the right branch on a turn's first fragment, since every string
  // starts with ''.
  ingest(next: string): void {
    const tail =
      next.length >= this.consumed ? next.slice(this.consumed) : undefined;
    if (tail !== undefined && tail.startsWith(this.text)) this.text = tail;
    else this.text += next;
    if (this.text.length > MAX_RETAINED_CHARACTERS) {
      const dropped = this.text.length - MAX_RETAINED_CHARACTERS;
      this.consumed += dropped;
      this.text = this.text.slice(dropped);
    }
  }

  value(): string {
    return this.text;
  }

  // The server restarts its cumulative text with each turn, so the offset has
  // to restart with it.
  reset(): void {
    this.consumed = 0;
    this.text = '';
  }
}

// Turns the two independent transcription streams into the caption rows the
// window renders: one model turn is one row, carrying its own original and
// translation.
export class GeminiCaptionAccumulator {
  private readonly original = new TurnStream();
  private pendingRollover = false;
  private readonly translation = new TurnStream();
  private turnIndex = 0;

  ingest(event: {
    original?: string;
    translation?: string;
    turnComplete: boolean;
  }): CaptionPairEvent | undefined {
    if (event.original !== undefined) {
      // The row only turns over once the next utterance actually starts, so a
      // translation still arriving after turnComplete lands on the row it
      // belongs to instead of opening an empty new one.
      if (this.pendingRollover) {
        this.pendingRollover = false;
        this.turnIndex += 1;
        this.original.reset();
        this.translation.reset();
      }
      this.original.ingest(event.original);
    }
    if (event.translation !== undefined) {
      this.translation.ingest(event.translation);
    }
    if (event.turnComplete) this.pendingRollover = true;
    if (event.original === undefined && event.translation === undefined) {
      return undefined;
    }
    const original = this.original.value();
    const translation = this.translation.value();
    if (!original && !translation) return undefined;
    return {
      original,
      translation,
      turnId: `turn-${this.turnIndex}`,
    };
  }

  // A reconnect resumes the session but not the utterance, so whatever comes
  // back must not be appended to the row that was open when the socket dropped.
  closeTurn(): void {
    this.pendingRollover = true;
  }
}
