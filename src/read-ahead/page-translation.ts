// The page's translation of a chunk's sentences (ADR 0006, issue #29), in
// order: Groq (Qwen) when the viewer chose it, then Chrome's built-in
// Translator, then Google's web translation, all within what is left of the
// chunk's budget. A chunk Groq (Qwen) cannot translate falls back to Chrome's
// Translator for that chunk only; the viewer's choice does not change.
import type { ReadAheadTranslator } from '../core/settings';
import { withDeadline, type ChunkSentence } from './gemini-chunk-translation';
import type { TranslationContext } from './groq-translation';

export interface PageLanguages {
  sourceLanguage?: string;
  targetLanguage: string;
}

export interface PageTranslators {
  // Chrome's built-in Translator; rejects with Error('translator_unsupported')
  // where it cannot translate.
  chrome(sentences: ChunkSentence[], languages: PageLanguages): Promise<ChunkSentence[]>;
  // Google's web translation, through the background.
  web(sentences: ChunkSentence[], languages: PageLanguages, timeoutMs: number): Promise<ChunkSentence[]>;
  // Groq (Qwen), through the background; rejects with Error(<failure code>).
  groq(
    texts: string[],
    languages: PageLanguages,
    context: TranslationContext[],
    timeoutMs: number,
  ): Promise<string[]>;
  now(): number;
}

export interface PageTranslationResult {
  // Set when Groq (Qwen) was chosen but Chrome's Translator (or Google's web
  // translation) translated this chunk: 'quota' once Groq's daily quota for
  // it is used up, 'unavailable' for any other reason.
  fallback?: 'quota' | 'unavailable';
  // Why Groq (Qwen) did not translate this chunk, for the page console.
  fallbackReason?: string;
  sentences: ChunkSentence[];
  translator: 'chrome' | 'groq' | 'web';
}

// The shortest a step is ever given, however little of the budget is left.
export const MIN_PAGE_TRANSLATION_MS = 1_000;
// Chrome's Translator answers in well under a second once its pack is ready;
// longer means it is stuck (a pack still downloading), so the web takes over.
export const CHROME_TRANSLATION_MS = 3_000;
// Groq (Qwen) took 1–2 s for 18 sentences (2026-11-21); past this it is
// having trouble, and Chrome's Translator still needs its time after it.
export const GROQ_TRANSLATION_MS = 4_500;
// How many of the previous sentences go with a request as context.
const CONTEXT_SENTENCES = 2;
// Failures that every later chunk would meet too: skip Groq for the session.
const LASTING_FAILURES = ['quota_exceeded', 'invalid_credentials'];
// After a per-minute limit (a burst of chunks after a start or seek), the
// next chunks would meet it too: skip Groq this long instead of waiting on
// requests that fail.
export const GROQ_RATE_LIMIT_PAUSE_MS = 20_000;

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PageTranslation {
  private context: TranslationContext[] = [];
  private groqGivenUp: 'quota' | 'unavailable' | undefined;
  private groqPausedUntil = -Infinity;

  constructor(
    private readonly translators: PageTranslators,
    private readonly translator: ReadAheadTranslator,
  ) {}

  async translate(
    sentences: ChunkSentence[],
    languages: PageLanguages,
    started: number,
    budgetMs: number,
  ): Promise<PageTranslationResult> {
    const left = () => budgetMs - (this.translators.now() - started);
    let fallback: PageTranslationResult['fallback'];
    let fallbackReason: string | undefined;
    if (this.translator === 'groq') {
      const timeoutMs = Math.min(GROQ_TRANSLATION_MS, left() - CHROME_TRANSLATION_MS);
      if (this.groqGivenUp) {
        fallback = this.groqGivenUp;
        fallbackReason = 'given_up';
      } else if (this.translators.now() < this.groqPausedUntil) {
        fallback = 'unavailable';
        fallbackReason = 'rate_limit_pause';
      } else if (timeoutMs < MIN_PAGE_TRANSLATION_MS) {
        fallback = 'unavailable';
        fallbackReason = 'no_time_left';
      } else {
        try {
          const translations = await this.translators.groq(
            sentences.map((sentence) => sentence.original),
            languages,
            this.context,
            timeoutMs,
          );
          const translated = sentences.map((sentence, index) => ({
            ...sentence,
            translation: translations[index] ?? '',
          }));
          this.remember(translated);
          return { sentences: translated, translator: 'groq' };
        } catch (error) {
          const reason = reasonOf(error);
          fallbackReason = reason;
          const lasting = LASTING_FAILURES.find((code) => reason.includes(code));
          if (lasting) this.groqGivenUp = lasting === 'quota_exceeded' ? 'quota' : 'unavailable';
          if (reason.includes('rate_limited')) {
            this.groqPausedUntil = this.translators.now() + GROQ_RATE_LIMIT_PAUSE_MS;
          }
          fallback = lasting === 'quota_exceeded' ? 'quota' : 'unavailable';
        }
      }
    }
    const result = await this.translateOnDevice(sentences, languages, left);
    this.remember(result.sentences);
    return { ...result, ...(fallback ? { fallback, fallbackReason: fallbackReason ?? 'unknown' } : {}) };
  }

  private async translateOnDevice(
    sentences: ChunkSentence[],
    languages: PageLanguages,
    left: () => number,
  ): Promise<Omit<PageTranslationResult, 'fallback'>> {
    const remaining = () => Math.max(MIN_PAGE_TRANSLATION_MS, left());
    try {
      return {
        sentences: await withDeadline(
          this.translators.chrome(sentences, languages),
          Math.min(CHROME_TRANSLATION_MS, remaining()),
          'translator_timeout',
        ),
        translator: 'chrome',
      };
    } catch (error) {
      const reason = reasonOf(error);
      if (reason !== 'translator_unsupported' && reason !== 'translator_timeout') throw error;
      // The on-device Translator cannot do it here: Google's web
      // translation, through the background (ADR 0006).
      return {
        sentences: await this.translators.web(sentences, languages, remaining()),
        translator: 'web',
      };
    }
  }

  private remember(sentences: ChunkSentence[]): void {
    const translated = sentences
      .filter((sentence) => sentence.translation)
      .map((sentence) => ({ original: sentence.original, translation: sentence.translation }));
    this.context = [...this.context, ...translated].slice(-CONTEXT_SENTENCES);
  }
}
