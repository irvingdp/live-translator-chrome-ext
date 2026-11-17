// Read-ahead's fallback translation, used automatically when Chrome's built-in
// Translator cannot translate (ADR 0002): the web endpoint behind Google's page
// translation. It is not a public API: it needs no key, but it is outside
// Google's terms, can change or be blocked without notice, and is tried only
// after the on-device translator failed.
import { ChunkTranslationError } from './gemini-chunk-translation';

export const WEB_TRANSLATION_ORIGINS = [
  'https://translate.googleapis.com/*',
] as const;

const GOOGLE_TRANSLATE = 'https://translate.googleapis.com/translate_a/single';

export interface WebTranslationRequest {
  // A Gemini language code, or undefined to let the service detect it.
  sourceLanguage?: string;
  // A Gemini language code.
  targetLanguage: string;
  texts: string[];
}

// Gemini codes (the popup's list) → Google's, where they differ.
const GOOGLE_CODES: Record<string, string> = {
  fil: 'tl', he: 'iw', jv: 'jw', nb: 'no', 'pt-BR': 'pt', 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW',
};

export function googleLanguageCode(code: string): string {
  return GOOGLE_CODES[code] ?? code;
}

async function translateOneWithGoogle(
  text: string,
  request: WebTranslationRequest,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<string> {
  const url = new URL(GOOGLE_TRANSLATE);
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', request.sourceLanguage ? googleLanguageCode(request.sourceLanguage) : 'auto');
  url.searchParams.set('tl', googleLanguageCode(request.targetLanguage));
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);
  const response = await fetcher(url.toString(), { signal });
  if (!response.ok) throw new ChunkTranslationError('provider_unavailable', response.status);
  // [[["translated", "original", …], …], …]: the translation comes in pieces.
  const body = await response.json() as unknown;
  const pieces = Array.isArray(body) && Array.isArray(body[0]) ? body[0] as unknown[] : [];
  const translated = pieces
    .map((piece) => (Array.isArray(piece) && typeof piece[0] === 'string' ? piece[0] : ''))
    .join('');
  if (!translated) throw new ChunkTranslationError('invalid_response');
  return translated;
}

export function translateWithGoogle(
  request: WebTranslationRequest,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<string[]> {
  return Promise.all(request.texts.map((text) => translateOneWithGoogle(text, request, fetcher, signal)));
}

const globalFetch: typeof fetch = (input, init) => fetch(input, init);

// One request per sentence, all at once.
export async function translateOnWeb(
  request: WebTranslationRequest,
  signal?: AbortSignal,
  fetcher: typeof fetch = globalFetch,
): Promise<string[]> {
  if (request.texts.length === 0) return [];
  return translateWithGoogle(request, fetcher, signal);
}
