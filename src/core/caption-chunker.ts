// CaptionUnitSpan.end is exclusive; start/end are offsets into the original,
// untrimmed source text, and text always equals source.slice(start, end).
export interface CaptionUnitSpan {
  end: number;
  start: number;
  text: string;
}

type EndingPredicate = (text: string, index: number) => boolean;

const SENTENCE_ENDING_CHARACTERS = /[.?!。！？…]/u;
const CLAUSE_ENDING_CHARACTERS = /[,;:，、；：]/u;
const CLOSING_PUNCTUATION = /["'』」)）]/u;
const WHITESPACE = /\s/u;
const ASCII_PERIOD = '.';

function isWide(character: string): boolean {
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

function characterWidth(character: string): number {
  return isWide(character) ? 2 : 1;
}

export function visualWidth(text: string): number {
  let width = 0;
  for (const character of text) width += characterWidth(character);
  return width;
}

// An ASCII "." ends a sentence only when whitespace (or the end of the text)
// follows it, skipping over any immediately-trailing closing punctuation such
// as a quote mark. This keeps decimals ("3.14"), dotted hostnames
// ("example.com"), and initialisms ("U.S.") from fragmenting into separate
// sentences. CJK enders and "…" always end a sentence regardless of spacing.
function isSentenceEnder(text: string, index: number): boolean {
  const character = text[index]!;
  if (!SENTENCE_ENDING_CHARACTERS.test(character)) return false;
  if (character !== ASCII_PERIOD) return true;

  let next = index + 1;
  while (next < text.length && CLOSING_PUNCTUATION.test(text[next]!)) next += 1;
  const nextCharacter = text[next];
  return nextCharacter === undefined || WHITESPACE.test(nextCharacter);
}

function isClauseEnder(text: string, index: number): boolean {
  return CLAUSE_ENDING_CHARACTERS.test(text[index]!);
}

function trimmedSpan(
  text: string,
  start: number,
  end: number,
): CaptionUnitSpan | undefined {
  let head = start;
  let tail = end;
  while (head < tail && WHITESPACE.test(text[head]!)) head += 1;
  while (tail > head && WHITESPACE.test(text[tail - 1]!)) tail -= 1;
  if (head >= tail) return undefined;
  return { end: tail, start: head, text: text.slice(head, tail) };
}

function boundarySpans(
  text: string,
  from: number,
  to: number,
  isEnder: EndingPredicate,
): CaptionUnitSpan[] {
  const spans: CaptionUnitSpan[] = [];
  let cursor = from;
  let index = from;
  while (index < to) {
    if (!isEnder(text, index)) {
      index += 1;
      continue;
    }
    while (index + 1 < to && isEnder(text, index + 1)) index += 1;
    // A trailing closer (a quote, a closing bracket) belongs with the ender
    // it follows, not with the next unit.
    while (index + 1 < to && CLOSING_PUNCTUATION.test(text[index + 1]!)) {
      index += 1;
    }
    const span = trimmedSpan(text, cursor, index + 1);
    if (span) spans.push(span);
    cursor = index + 1;
    index = cursor;
  }
  const tail = trimmedSpan(text, cursor, to);
  if (tail) spans.push(tail);
  return spans;
}

function packSpans(
  text: string,
  spans: CaptionUnitSpan[],
  maxWidth: number,
): CaptionUnitSpan[] {
  const packed: CaptionUnitSpan[] = [];
  for (const span of spans) {
    const previous = packed[packed.length - 1];
    const merged = previous && trimmedSpan(text, previous.start, span.end);
    if (merged && visualWidth(merged.text) <= maxWidth) {
      packed[packed.length - 1] = merged;
      continue;
    }
    packed.push(span);
  }
  return packed;
}

function hardWrap(
  text: string,
  span: CaptionUnitSpan,
  maxWidth: number,
): CaptionUnitSpan[] {
  const units: CaptionUnitSpan[] = [];
  let start = span.start;
  while (start < span.end) {
    while (start < span.end && WHITESPACE.test(text[start]!)) start += 1;
    if (start >= span.end) break;
    let end = start;
    let width = 0;
    let lastBreakEnd = -1;
    while (end < span.end) {
      const character = String.fromCodePoint(text.codePointAt(end)!);
      const next = width + characterWidth(character);
      if (next > maxWidth) break;
      width = next;
      end += character.length;
      if (WHITESPACE.test(character)) lastBreakEnd = end;
    }
    if (end < span.end && lastBreakEnd > start) end = lastBreakEnd;
    // A limit narrower than one wide character must still make progress,
    // advancing by a whole code point so a surrogate pair is never split.
    if (end === start) {
      end = start + String.fromCodePoint(text.codePointAt(start)!).length;
    }
    const unit = trimmedSpan(text, start, end);
    if (unit) units.push(unit);
    start = end;
  }
  return units;
}

export function splitIntoUnits(
  text: string,
  maxWidth: number,
): CaptionUnitSpan[] {
  const units: CaptionUnitSpan[] = [];
  for (const sentence of boundarySpans(text, 0, text.length, isSentenceEnder)) {
    if (visualWidth(sentence.text) <= maxWidth) {
      units.push(sentence);
      continue;
    }
    const pieces: CaptionUnitSpan[] = [];
    for (const clause of boundarySpans(
      text,
      sentence.start,
      sentence.end,
      isClauseEnder,
    )) {
      if (visualWidth(clause.text) <= maxWidth) {
        pieces.push(clause);
        continue;
      }
      pieces.push(...hardWrap(text, clause, maxWidth));
    }
    // Pack after wrapping, and only within one sentence. Packing before the
    // wrap step leaves the leftover tail of an over-wide clause stranded on a
    // near-empty line; packing across sentences would put two sentences on one
    // line, which breaks the one-sentence-per-line rule.
    units.push(...packSpans(text, pieces, maxWidth));
  }
  return units;
}
