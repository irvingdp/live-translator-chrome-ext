// Sentence boundaries for Gemini live's caption pairing. Gemini returns the
// source and target transcription as independent streams whose visual lengths
// can differ dramatically, so pairing uses semantic sentence boundaries rather
// than width-based chunks; the renderer wraps each paired sentence to its
// available width afterwards.

// SentenceSpan.end is exclusive; start/end are offsets into the original,
// untrimmed source text, and text always equals source.slice(start, end).
export interface SentenceSpan {
  end: number;
  start: number;
  text: string;
}

const SENTENCE_ENDING_CHARACTERS = /[.?!。！？…]/u;
const CLOSING_PUNCTUATION = /["'』」)）”’\]}》〉】〕»]/u;
const WHITESPACE = /\s/u;
const ASCII_PERIOD = '.';

export function isWideCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

// Advances past a run of closing punctuation (a quote, a closing bracket)
// starting at `index`, without scanning past `limit`. Shared by the sentence
// lookahead and the ender-absorption loop so the two can never disagree
// about where a closer run ends.
function skipClosers(text: string, index: number, limit: number): number {
  let next = index;
  while (next < limit && CLOSING_PUNCTUATION.test(text[next]!)) next += 1;
  return next;
}

// An ASCII "." ends a sentence only when whitespace (or `limit`, the end of
// the scanned range) follows it, skipping over any immediately-trailing
// closing punctuation such as a quote mark first. This keeps decimals
// ("3.14"), dotted hostnames ("example.com"), and initialisms ("U.S.") from
// fragmenting into separate sentences. CJK enders and "…" always end a
// sentence regardless of spacing.
function isSentenceEnder(text: string, index: number, limit: number): boolean {
  const character = text[index]!;
  if (!SENTENCE_ENDING_CHARACTERS.test(character)) return false;
  if (character !== ASCII_PERIOD) return true;

  const next = skipClosers(text, index + 1, limit);
  return next >= limit || WHITESPACE.test(text[next]!);
}

function trimmedSpan(
  text: string,
  start: number,
  end: number,
): SentenceSpan | undefined {
  let head = start;
  let tail = end;
  while (head < tail && WHITESPACE.test(text[head]!)) head += 1;
  while (tail > head && WHITESPACE.test(text[tail - 1]!)) tail -= 1;
  if (head >= tail) return undefined;
  return { end: tail, start: head, text: text.slice(head, tail) };
}

export function splitIntoSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const to = text.length;
  let cursor = 0;
  let index = 0;
  while (index < to) {
    if (!isSentenceEnder(text, index, to)) {
      index += 1;
      continue;
    }
    while (index + 1 < to && isSentenceEnder(text, index + 1, to)) index += 1;
    // A trailing closer (a quote, a closing bracket) belongs with the ender
    // it follows, not with the next sentence.
    index = skipClosers(text, index + 1, to) - 1;
    const span = trimmedSpan(text, cursor, index + 1);
    if (span) spans.push(span);
    cursor = index + 1;
    index = cursor;
  }
  const tail = trimmedSpan(text, cursor, to);
  if (tail) spans.push(tail);
  return spans;
}
