export interface CaptionUnitSpan {
  end: number;
  start: number;
  text: string;
}

const SENTENCE_ENDING = /[.?!。！？…]/u;
const CLAUSE_ENDING = /[,;:，、；：]/u;
const WHITESPACE = /\s/u;

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

export function visualWidth(text: string): number {
  let width = 0;
  for (const character of text) width += isWide(character) ? 2 : 1;
  return width;
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
  ending: RegExp,
): CaptionUnitSpan[] {
  const spans: CaptionUnitSpan[] = [];
  let cursor = from;
  let index = from;
  while (index < to) {
    if (!ending.test(text[index]!)) {
      index += 1;
      continue;
    }
    while (index + 1 < to && ending.test(text[index + 1]!)) index += 1;
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
    let lastBreak = -1;
    while (end < span.end) {
      const character = text[end]!;
      const next = width + (isWide(character) ? 2 : 1);
      if (next > maxWidth) break;
      width = next;
      end += 1;
      if (WHITESPACE.test(character)) lastBreak = end;
    }
    if (end < span.end && lastBreak > start) end = lastBreak;
    // A limit narrower than one wide character must still make progress.
    if (end === start) end = start + 1;
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
  for (const sentence of boundarySpans(text, 0, text.length, SENTENCE_ENDING)) {
    if (visualWidth(sentence.text) <= maxWidth) {
      units.push(sentence);
      continue;
    }
    const pieces: CaptionUnitSpan[] = [];
    for (const clause of boundarySpans(
      text,
      sentence.start,
      sentence.end,
      CLAUSE_ENDING,
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
