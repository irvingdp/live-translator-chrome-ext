// Read-ahead translation with Chrome's built-in, on-device Translator API
// (issue #11). It exists only in documents, not in the service worker, so the
// page translates the sentences the background recognized. No quota, no key;
// the quality is below Gemini's and needs the language pack downloaded (the
// popup starts that download, since creating a translator that still has to
// download needs a user gesture).
import type { ChunkSentence } from './gemini-chunk-translation';

type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

interface ChromeTranslator {
  translate(text: string): Promise<string>;
}

export interface TranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
  create(options: { sourceLanguage: string; targetLanguage: string }): Promise<ChromeTranslator>;
}

export interface LanguageDetectorApi {
  create(): Promise<{
    detect(text: string): Promise<Array<{ confidence: number; detectedLanguage: string }>>;
  }>;
}

// Chrome's codes differ from Gemini's for a few languages.
export function chromeLanguageCode(code: string): string {
  if (code === 'zh-Hans') return 'zh';
  if (code === 'pt-BR' || code === 'pt-PT') return 'pt';
  return code;
}

function base(code: string): string {
  return code.split('-')[0]!.toLowerCase();
}

export class ChromeTranslation {
  private readonly translators = new Map<string, Promise<ChromeTranslator>>();

  constructor(
    private readonly translator: TranslatorApi | undefined,
    private readonly detector: LanguageDetectorApi | undefined,
  ) {}

  static fromWindow(view: Window): ChromeTranslation {
    const scope = view as unknown as { LanguageDetector?: LanguageDetectorApi; Translator?: TranslatorApi };
    return new ChromeTranslation(scope.Translator, scope.LanguageDetector);
  }

  // Throws Error('translator_unsupported') when this browser, or this
  // language pair, cannot be translated here.
  async translate(
    sentences: ChunkSentence[],
    languages: { sourceLanguage?: string; targetLanguage: string },
  ): Promise<ChunkSentence[]> {
    if (sentences.length === 0) return sentences;
    if (!this.translator) throw new Error('translator_unsupported');
    const source = languages.sourceLanguage ??
      await this.detect(sentences.map((sentence) => sentence.original).join(' '));
    if (!source) throw new Error('translator_unsupported');
    if (base(source) === base(languages.targetLanguage)) {
      return sentences.map((sentence) => ({ ...sentence, sameLanguage: true, translation: '' }));
    }
    const translator = await this.translatorFor(
      chromeLanguageCode(source),
      chromeLanguageCode(languages.targetLanguage),
    );
    const translated: ChunkSentence[] = [];
    for (const sentence of sentences) {
      translated.push({ ...sentence, translation: await translator.translate(sentence.original) });
    }
    return translated;
  }

  private async detect(text: string): Promise<string | undefined> {
    if (!this.detector) return undefined;
    try {
      const [best] = await (await this.detector.create()).detect(text);
      return best && best.detectedLanguage !== 'und' ? best.detectedLanguage : undefined;
    } catch {
      return undefined;
    }
  }

  private translatorFor(sourceLanguage: string, targetLanguage: string): Promise<ChromeTranslator> {
    const key = `${sourceLanguage}>${targetLanguage}`;
    let translator = this.translators.get(key);
    if (!translator) {
      translator = (async () => {
        const api = this.translator!;
        const availability = await api.availability({ sourceLanguage, targetLanguage });
        if (availability === 'unavailable') throw new Error('translator_unsupported');
        try {
          return await api.create({ sourceLanguage, targetLanguage });
        } catch {
          // A pack still to download cannot start without a user gesture.
          throw new Error('translator_unsupported');
        }
      })();
      // A failure is retried on the next chunk (the popup may have finished
      // the download meanwhile).
      translator.catch(() => this.translators.delete(key));
      this.translators.set(key, translator);
    }
    return translator;
  }
}
