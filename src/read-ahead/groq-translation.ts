// Read-ahead translation through a language model on Groq (issue #29, ADR
// 0011): one chunk's sentences → one chat request, answered as a JSON array
// of translations in the same order. Unlike Chrome's built-in Translator it
// reads the sentences together, plus the previous chunk's last ones, so
// pronouns, names and terms stay consistent and idioms are translated by
// meaning. It uses the viewer's Groq key, with a quota of its own.
import {
  CHUNK_REQUEST_TIMEOUT_MS,
  ChunkTranslationError,
  languageName,
  withRequestTimeout,
} from './gemini-chunk-translation';
import { groqErrorForResponse } from './groq-transcription';

// Fixed (ADR 0011): the best of the Groq models measured on 2026-11-21, and
// fast enough for the page's budget.
export const GROQ_TRANSLATION_MODEL = 'qwen/qwen3.8-27b';
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

// Sentences translated just before, given for context only.
export interface TranslationContext {
  original: string;
  translation: string;
}

export interface GroqTranslationRequest {
  apiKey: string;
  context?: TranslationContext[];
  // A Gemini language code, or undefined when it is not known.
  sourceLanguage?: string;
  targetLanguage: string;
  texts: string[];
}

// How each target language is best written, where it differs by region.
const REGIONAL_USAGE: Record<string, string> = {
  'zh-HK': 'Traditional Chinese as written in Hong Kong',
  'zh-Hans': 'Simplified Chinese as used in mainland China',
  'zh-Hant': 'Traditional Chinese as used in Taiwan (Taiwanese vocabulary, e.g. 影片 not 視頻)',
};

export function buildTranslationPrompt(request: GroqTranslationRequest): string {
  const target = REGIONAL_USAGE[request.targetLanguage]
    ? `${languageName(request.targetLanguage)}: ${REGIONAL_USAGE[request.targetLanguage]}`
    : languageName(request.targetLanguage);
  const source = request.sourceLanguage ? ` from ${languageName(request.sourceLanguage)}` : '';
  const lines = [
    `Translate each sentence${source} into ${target}.`,
    'They are consecutive subtitles of one video: keep pronouns, names and terms consistent, and translate idioms and figures of speech by meaning, not word for word.',
    'The sentences are a JSON object keyed by number. Return only a JSON object with exactly the same keys, each mapped to its translation as a string, with nothing else.',
    'Translate every key separately, even a repeated sentence, a fragment or an interjection: never merge, split, skip or add keys.',
  ];
  if (request.context?.length) {
    lines.push(
      'For context only, these came just before (do not translate or return them):',
      JSON.stringify(request.context.map((item) => ({ original: item.original, translation: item.translation }))),
    );
  }
  lines.push('Sentences:', JSON.stringify(numbered(request.texts)));
  return lines.join('\n');
}

// The sentences keyed "1", "2", …: a model returns a numbered object far
// more faithfully than an array, which it tends to shorten by merging a
// repeated sentence or dropping an interjection.
function numbered(texts: string[]): Record<string, string> {
  return Object.fromEntries(texts.map((text, index) => [String(index + 1), text]));
}

function jsonIn(content: string, open: string, close: string): unknown {
  const start = content.indexOf(open);
  const end = content.lastIndexOf(close);
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

// The translations in the model's reply, which may come wrapped in a code
// fence or a sentence: an object keyed like the input (or, from an older
// prompt, an array). Undefined when one is missing or not a string.
export function parseTranslations(content: string, count: number): string[] | undefined {
  const object = jsonIn(content, '{', '}');
  let translations: unknown[] | undefined;
  if (object && typeof object === 'object' && !Array.isArray(object)) {
    const record = object as Record<string, unknown>;
    translations = Array.from({ length: count }, (_, index) => record[String(index + 1)]);
  } else {
    const array = jsonIn(content, '[', ']');
    if (Array.isArray(array) && array.length === count) translations = array;
  }
  if (!translations || translations.some((item) => typeof item !== 'string')) return undefined;
  return (translations as string[]).map((item) => item.trim());
}

async function requestTranslation(
  request: GroqTranslationRequest,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<string[]> {
  if (request.texts.length === 0) return [];
  let response: Response;
  try {
    response = await fetcher(ENDPOINT, {
      body: JSON.stringify({
        messages: [{ content: buildTranslationPrompt(request), role: 'user' }],
        model: GROQ_TRANSLATION_MODEL,
        // Thinking would take seconds the page's budget does not have.
        reasoning_effort: 'none',
        temperature: 0.2,
      }),
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ChunkTranslationError('network_error');
  }
  if (!response.ok) throw await groqErrorForResponse(response);
  let body: { choices?: Array<{ message?: { content?: unknown } }> };
  try {
    body = await response.json() as typeof body;
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ChunkTranslationError('invalid_response');
  }
  const content = body.choices?.[0]?.message?.content;
  const translations = typeof content === 'string'
    ? parseTranslations(content, request.texts.length)
    : undefined;
  if (!translations) {
    // What the model said instead, for the page console.
    throw Object.assign(new ChunkTranslationError('invalid_response'), {
      detail: typeof content === 'string' ? content.slice(0, 300) : typeof content,
    });
  }
  return translations;
}

const globalFetch: typeof fetch = (input, init) => fetch(input, init);

export function translateWithGroq(
  request: GroqTranslationRequest,
  fetcher: typeof fetch = globalFetch,
  timeoutMs = CHUNK_REQUEST_TIMEOUT_MS,
): Promise<string[]> {
  return withRequestTimeout(
    (signal) => requestTranslation(request, fetcher, signal),
    timeoutMs,
  );
}
