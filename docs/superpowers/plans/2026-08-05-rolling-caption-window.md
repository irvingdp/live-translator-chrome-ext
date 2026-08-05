# Rolling Caption Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the growing single-segment caption with a rolling window of two display units — one original line and one translation line each — that slides up when a new unit arrives, plus user controls for line width, background opacity, and vertical position.

**Architecture:** The background service worker cuts stabilized transcript text into roughly one-line display units (`CaptionChunker`), keeps the last two in `CaptionWindow`, and sends the whole window to the content script as one idempotent `CAPTION_WINDOW` message. `CaptionOverlay` becomes a pure renderer that diffs the window against the DOM and animates the push. Appearance settings reach the overlay through `chrome.storage` so they apply to a running session.

**Tech Stack:** TypeScript, WXT (Manifest V3), React 19 (popup/options), Vitest + jsdom, Playwright for browser verification.

**Design spec:** `docs/superpowers/specs/2026-08-05-rolling-caption-window-design.md`

**Before you start:** this repo pins Node 22 in `.nvmrc` but the shell may default to Node 20, which crashes Vitest with `webidl.util.markAsUncloneable is not a function`. Prefix every command in this plan with:

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
```

---

## File Structure

**Create:**
- `src/core/caption-chunker.ts` — visual width, unit splitting, and the stateful per-segment chunker
- `src/core/caption-window.ts` — the two-unit rolling window
- `tests/core/caption-chunker.test.ts`
- `tests/core/caption-window.test.ts`

**Modify:**
- `src/core/settings.ts` — three new clamped fields plus shared ranges
- `src/core/transcript-stabilizer.ts` — expose full stable text, drop the phrase machinery
- `src/core/capture-session-controller.ts` — `TabMessage` protocol, chunk-keyed translation, window sending
- `src/content/caption-overlay.ts` — window rendering, push animation, appearance object
- `entrypoints/captions.content.ts` — storage-driven appearance, `CAPTION_WINDOW` handling
- `entrypoints/background.ts` — live `maxLineWidth` updates
- `src/popup/PopupApp.tsx` — `RangeField` bounds props and three new sliders
- `tests/core/transcript-stabilizer.test.ts`, `tests/core/settings.test.ts`, `tests/core/capture-session-controller.test.ts`, `tests/content/caption-overlay.test.ts`, `tests/popup/popup-app.test.tsx` — rewritten against the new contracts

---

### Task 1: Visual width and unit splitting

Pure functions with no state. `visualWidth` counts CJK and fullwidth characters as 2 so one width limit works for both Latin and CJK sources. `splitIntoUnits` returns spans with offsets into the source string, which Task 2 needs to locate where the open unit begins.

**Files:**
- Create: `src/core/caption-chunker.ts`
- Test: `tests/core/caption-chunker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/caption-chunker.test.ts
import { describe, expect, it } from 'vitest';

import { splitIntoUnits, visualWidth } from '../../src/core/caption-chunker';

describe('visualWidth', () => {
  it('counts CJK characters as two columns and Latin as one', () => {
    expect(visualWidth('abc')).toBe(3);
    expect(visualWidth('大家早安')).toBe(8);
    expect(visualWidth('a大')).toBe(3);
  });
});

describe('splitIntoUnits', () => {
  it('keeps a short sentence whole and keeps its punctuation', () => {
    expect(splitIntoUnits('Hello there. Next one.', 40).map((unit) => unit.text))
      .toEqual(['Hello there.', 'Next one.']);
  });

  it('splits an over-wide sentence at clause punctuation', () => {
    const text = 'And the people who were in this program, given a chance, learn skills.';

    expect(splitIntoUnits(text, 30).map((unit) => unit.text)).toEqual([
      'And the people who were in',
      'this program, given a chance,',
      'learn skills.',
    ]);
  });

  it('hard wraps at the last word boundary when there is no punctuation', () => {
    expect(splitIntoUnits('one two three four five six', 12).map((unit) => unit.text))
      .toEqual(['one two', 'three four', 'five six']);
  });

  it('reports offsets into the source text', () => {
    const [first, second] = splitIntoUnits('Hello there. Next one.', 40);

    expect(first).toMatchObject({ start: 0, end: 12 });
    expect(second).toMatchObject({ start: 13, end: 22 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/caption-chunker.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/caption-chunker"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/caption-chunker.ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/core/caption-chunker.test.ts`
Expected: PASS — 5 tests.

All four `splitIntoUnits` expectations were traced by hand against this
algorithm, so a failure means the implementation diverged from the plan, not
that the expectation is wrong. If you do need to change an expectation, first
confirm by hand that every unit is within the width limit and that no
characters were dropped. Greedy packing from the left is what makes closed unit
boundaries depend only on the prefix, so do not reorder the split, wrap, and
pack stages to satisfy a guessed expectation.

- [ ] **Step 5: Commit**

```bash
git add src/core/caption-chunker.ts tests/core/caption-chunker.test.ts
git commit -m "feat: split transcript text into caption-sized units"
```

#### Amendment after code review (commit `18da1dd`)

The source above is what was implemented first, in commit `225cb1e`. Code
review then found three real defects in it, so **the code above is no longer
the current implementation** — read the file, not this block. The corrected
behavior is now described in the design spec's boundary rules. What changed:

1. An ASCII `.` only ends a sentence when whitespace or end-of-text follows,
   looking past any closing punctuation first. Without this, Deepgram's smart
   formatting (`3.14`, `example.com`, `U.S.`) fragmented into separate
   *sentences*, which rule 4 can never rejoin. `Mr. Smith` still splits; an
   abbreviation list was ruled out as speculative.
2. `visualWidth` and `hardWrap` now share one `characterWidth` helper and both
   iterate by code point. `hardWrap` previously indexed UTF-16 code units, so it
   could cut an astral character into lone surrogates — while `isWide` claims to
   support CJK Extension B — and the two call sites disagreed on emoji width.
3. Trailing closing punctuation (`"`, `'`, `』`, `」`, `)`, `）`) is absorbed
   into the unit it ends, instead of being stranded at the start of the next one.

Tests grew from 5 to 21, covering the gaps the spec's testing section already
asked for: CJK through the splitter itself (not only through `visualWidth`),
ideographic punctuation in both stages, an unbreakable Latin word, the
forced-progress guard, and — instead of only literal offsets — the invariants
`text === source.slice(start, end)`, `visualWidth(text) <= maxWidth`, a
whitespace-stripped round trip, and prefix stability across growing prefixes.

Later tasks are unaffected: Task 2's fixtures (`Hello there.`,
`Hello there. And now.`) split identically under the corrected rule, since every
`.` in them is followed by a space or ends the string.

---

### Task 2: Stateful chunker with frozen closed units

The chunker turns each stabilizer update into the units whose text changed. Only the last unit of a non-final segment stays open; earlier units are frozen so a later Deepgram revision cannot rewrite text the viewer has already read. The open unit displays the raw interim remainder so the third line tracks speech, while its `translateText` holds only the stabilized part.

**Files:**
- Modify: `src/core/caption-chunker.ts`
- Test: `tests/core/caption-chunker.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/core/caption-chunker.test.ts`, and add `CaptionChunker` to the existing import from `../../src/core/caption-chunker`:

```ts
describe('CaptionChunker', () => {
  const ingest = (
    chunker: CaptionChunker,
    stableText: string,
    rawText = stableText,
    isFinal = false,
  ) =>
    chunker.ingest({
      isFinal,
      maxWidth: 20,
      rawText,
      segmentId: 'segment-1',
      stableText,
    });

  it('shows the raw interim remainder as the open unit', () => {
    const chunker = new CaptionChunker();

    expect(ingest(chunker, 'Good morning', 'Good morning every')).toEqual([
      {
        displayText: 'Good morning every',
        id: 'segment-1#0',
        index: 0,
        isClosed: false,
        translateText: 'Good morning',
      },
    ]);
  });

  it('closes a unit once a later unit exists and keeps its text frozen', () => {
    const chunker = new CaptionChunker();
    ingest(chunker, 'Hello there.', 'Hello there. And');

    const units = ingest(chunker, 'Hello there. And now', 'Hello there. And now we');

    expect(units).toEqual([
      {
        displayText: 'Hello there.',
        id: 'segment-1#0',
        index: 0,
        isClosed: true,
        translateText: 'Hello there.',
      },
      {
        displayText: 'And now we',
        id: 'segment-1#1',
        index: 1,
        isClosed: false,
        translateText: 'And now',
      },
    ]);
  });

  it('keeps a frozen unit even when a later revision contradicts it', () => {
    const chunker = new CaptionChunker();
    ingest(chunker, 'Hello there. And now');

    const units = ingest(chunker, 'Hello THERE. And now then');

    expect(units.map((unit) => unit.id)).toEqual(['segment-1#1']);
    expect(units[0]).toMatchObject({ displayText: 'And now then' });
  });

  it('closes every unit when the segment is final', () => {
    const chunker = new CaptionChunker();
    // Only unit 0 exists so far, and it is still open: the whole raw text is
    // displayed as one unit because the stable text has no second unit yet.
    ingest(chunker, 'Hello there.', 'Hello there. And now');

    const units = ingest(chunker, 'Hello there. And now.', 'Hello there. And now.', true);

    // Both units close, and unit 0 is re-emitted so its display text shrinks
    // from the whole raw text to its own frozen sentence.
    expect(units.map((unit) => ({ id: unit.id, isClosed: unit.isClosed }))).toEqual([
      { id: 'segment-1#0', isClosed: true },
      { id: 'segment-1#1', isClosed: true },
    ]);
    expect(units[0]).toMatchObject({ displayText: 'Hello there.' });
    expect(units[1]).toMatchObject({ displayText: 'And now.' });
  });

  it('emits nothing when neither displayed nor translatable text changed', () => {
    const chunker = new CaptionChunker();
    ingest(chunker, 'Good morning');

    expect(ingest(chunker, 'Good morning')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/caption-chunker.test.ts`
Expected: FAIL — `CaptionChunker is not a constructor` / not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/core/caption-chunker.ts`:

```ts
export interface CaptionUnit {
  displayText: string;
  id: string;
  index: number;
  isClosed: boolean;
  translateText: string;
}

export interface CaptionChunkerInput {
  isFinal: boolean;
  maxWidth: number;
  rawText: string;
  segmentId: string;
  stableText: string;
}

interface SegmentUnits {
  closed: string[];
  openDisplay: string;
  openTranslate: string;
}

export class CaptionChunker {
  private readonly segments = new Map<string, SegmentUnits>();

  ingest(input: CaptionChunkerInput): CaptionUnit[] {
    const state = this.segments.get(input.segmentId) ?? {
      closed: [],
      openDisplay: '',
      openTranslate: '',
    };
    const spans = splitIntoUnits(input.stableText, input.maxWidth);
    const closedCount = input.isFinal
      ? spans.length
      : Math.max(spans.length - 1, 0);
    const changed: CaptionUnit[] = [];

    for (let index = state.closed.length; index < closedCount; index += 1) {
      const span = spans[index]!;
      state.closed.push(span.text);
      changed.push({
        displayText: span.text,
        id: `${input.segmentId}#${index}`,
        index,
        isClosed: true,
        translateText: span.text,
      });
    }

    if (input.isFinal) {
      this.segments.delete(input.segmentId);
      return changed;
    }

    const openSpan = spans[closedCount];
    const openStart = openSpan?.start ?? spans[closedCount - 1]?.end ?? 0;
    // Stabilized text is a prefix of the raw interim text, so an offset in one
    // is an offset in the other. Fall back if a provider ever breaks that.
    const source = input.rawText.startsWith(input.stableText)
      ? input.rawText
      : input.stableText;
    const displayText = source.slice(Math.min(openStart, source.length)).trim();
    const translateText = openSpan?.text ?? '';

    if (
      displayText &&
      (displayText !== state.openDisplay || translateText !== state.openTranslate)
    ) {
      state.openDisplay = displayText;
      state.openTranslate = translateText;
      changed.push({
        displayText,
        id: `${input.segmentId}#${closedCount}`,
        index: closedCount,
        isClosed: false,
        translateText,
      });
    }

    this.segments.set(input.segmentId, state);
    return changed;
  }

  clear(): void {
    this.segments.clear();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/core/caption-chunker.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/caption-chunker.ts tests/core/caption-chunker.test.ts
git commit -m "feat: freeze closed caption units per segment"
```

---

### Task 3: CaptionWindow

**Files:**
- Create: `src/core/caption-window.ts`
- Test: `tests/core/caption-window.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/caption-window.test.ts
import { describe, expect, it } from 'vitest';

import { CaptionWindow } from '../../src/core/caption-window';

describe('CaptionWindow', () => {
  it('keeps only the last two units in arrival order', () => {
    const window = new CaptionWindow();
    window.upsertOriginal('a', 'first');
    window.upsertOriginal('b', 'second');
    window.upsertOriginal('c', 'third');

    expect(window.pairs()).toEqual([
      { id: 'b', original: 'second', translation: '' },
      { id: 'c', original: 'third', translation: '' },
    ]);
  });

  it('updates an existing unit without changing its position', () => {
    const window = new CaptionWindow();
    window.upsertOriginal('a', 'first');
    window.upsertOriginal('b', 'second');
    window.upsertOriginal('a', 'first revised');

    expect(window.pairs().map((pair) => pair.id)).toEqual(['a', 'b']);
    expect(window.pairs()[0]).toMatchObject({ original: 'first revised' });
  });

  it('ignores a translation for a unit that has already been dropped', () => {
    const window = new CaptionWindow();
    window.upsertOriginal('a', 'first');
    window.upsertOriginal('b', 'second');
    window.upsertOriginal('c', 'third');
    window.upsertTranslation('a', '第一');

    expect(window.pairs().every((pair) => pair.translation === '')).toBe(true);
  });

  it('clears every unit', () => {
    const window = new CaptionWindow();
    window.upsertOriginal('a', 'first');
    window.clear();

    expect(window.pairs()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/caption-window.test.ts`
Expected: FAIL — cannot resolve `../../src/core/caption-window`.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/caption-window.ts
export interface CaptionPair {
  id: string;
  original: string;
  translation: string;
}

const maxPairs = 2;

export class CaptionWindow {
  private readonly entries = new Map<string, CaptionPair>();
  private readonly order: string[] = [];

  upsertOriginal(id: string, original: string): void {
    const existing = this.entries.get(id);
    if (existing) {
      existing.original = original;
      return;
    }
    this.entries.set(id, { id, original, translation: '' });
    this.order.push(id);
    while (this.order.length > maxPairs) {
      const dropped = this.order.shift();
      if (dropped !== undefined) this.entries.delete(dropped);
    }
  }

  upsertTranslation(id: string, translation: string): void {
    const existing = this.entries.get(id);
    if (!existing) return;
    existing.translation = translation;
  }

  pairs(): CaptionPair[] {
    return this.order.flatMap((id) => {
      const entry = this.entries.get(id);
      return entry ? [{ ...entry }] : [];
    });
  }

  clear(): void {
    this.order.length = 0;
    this.entries.clear();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/core/caption-window.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/caption-window.ts tests/core/caption-window.test.ts
git commit -m "feat: add rolling two-unit caption window"
```

---

### Task 4: Three new settings with shared ranges

`SETTING_RANGES` is exported so the popup sliders and the clamping logic cannot drift apart.

**Files:**
- Modify: `src/core/settings.ts`
- Modify: `src/core/capture-session-controller.ts` (the `SessionSettings` interface only)
- Test: `tests/core/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/core/settings.test.ts`:

```ts
it('defaults the layout settings to a visible caption box', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({
    backgroundOpacity: 78,
    bottomOffset: 8,
    maxLineWidth: 90,
  });
});

it('clamps the layout settings to their ranges', () => {
  expect(
    normalizeSettings({ backgroundOpacity: 150, bottomOffset: -5, maxLineWidth: 999 }),
  ).toMatchObject({
    backgroundOpacity: 100,
    bottomOffset: 0,
    maxLineWidth: 140,
  });
});

it('rounds fractional layout settings', () => {
  expect(normalizeSettings({ maxLineWidth: 90.6 })).toMatchObject({
    maxLineWidth: 91,
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/settings.test.ts`
Expected: FAIL — received object lacks `backgroundOpacity`, `bottomOffset`, `maxLineWidth`.

- [ ] **Step 3: Write the implementation**

In `src/core/capture-session-controller.ts`, add three fields to `SessionSettings`:

```ts
export interface SessionSettings {
  backgroundOpacity: number;
  bottomOffset: number;
  deepgramApiKey: string;
  deeplApiKey: string;
  maxLineWidth: number;
  sourceLanguage: string;
  sourceLocale: string;
  targetLanguage: string;
  originalFontSize: number;
  translationFontSize: number;
}
```

In `src/core/settings.ts`, replace the `fontSize` helper and extend the defaults and normalizer:

```ts
export const SETTING_RANGES = {
  backgroundOpacity: { max: 100, min: 0 },
  bottomOffset: { max: 60, min: 0 },
  maxLineWidth: { max: 140, min: 40 },
  originalFontSize: { max: 48, min: 16 },
  translationFontSize: { max: 48, min: 16 },
} as const;

export const DEFAULT_SETTINGS: AppSettings = {
  backgroundOpacity: 78,
  bottomOffset: 8,
  deepgramApiKey: '',
  deeplApiKey: '',
  maxLineWidth: 90,
  originalFontSize: 24,
  sourceLanguage: 'EN',
  sourceLocale: 'en-US',
  targetLanguage: 'ZH-HANT',
  translationFontSize: 22,
};

function clamped(
  value: unknown,
  range: { max: number; min: number },
  fallback: number,
): number {
  const numeric =
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(numeric)));
}
```

Then in `normalizeSettings`, return the three new fields alongside the existing ones, replacing every `fontSize(...)` call:

```ts
    backgroundOpacity: clamped(
      raw.backgroundOpacity,
      SETTING_RANGES.backgroundOpacity,
      DEFAULT_SETTINGS.backgroundOpacity,
    ),
    bottomOffset: clamped(
      raw.bottomOffset,
      SETTING_RANGES.bottomOffset,
      DEFAULT_SETTINGS.bottomOffset,
    ),
    maxLineWidth: clamped(
      raw.maxLineWidth,
      SETTING_RANGES.maxLineWidth,
      DEFAULT_SETTINGS.maxLineWidth,
    ),
    originalFontSize: clamped(
      raw.originalFontSize,
      SETTING_RANGES.originalFontSize,
      DEFAULT_SETTINGS.originalFontSize,
    ),
    translationFontSize: clamped(
      raw.translationFontSize,
      SETTING_RANGES.translationFontSize,
      DEFAULT_SETTINGS.translationFontSize,
    ),
```

Delete the now-unused `fontSize` function.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/core/settings.test.ts && npx tsc --noEmit`
Expected: settings tests PASS. `tsc` reports errors only in test files that build a `SessionSettings` literal — leave those for Task 6, which rewrites them.

- [ ] **Step 5: Commit**

```bash
git add src/core/settings.ts src/core/capture-session-controller.ts tests/core/settings.test.ts
git commit -m "feat: add caption layout settings"
```

---

### Task 5: Stabilizer exposes full stable text

Chunk-level translation replaces phrase-level translation, so the stabilizer no longer needs to compute untranslated suffixes or `mode: 'replace'`. It now reports the raw interim text and the full stabilized text, and stable text never shrinks — that is what keeps frozen units trustworthy.

**Files:**
- Modify: `src/core/transcript-stabilizer.ts`
- Test: `tests/core/transcript-stabilizer.test.ts` (rewrite)

- [ ] **Step 1: Rewrite the test file**

```ts
// tests/core/transcript-stabilizer.test.ts
import { describe, expect, it } from 'vitest';

import { TranscriptStabilizer } from '../../src/core/transcript-stabilizer';

describe('TranscriptStabilizer', () => {
  const event = (text: string, revision: number, isFinal = false) => ({
    isFinal,
    revision,
    segmentId: 'segment-1',
    text,
  });

  it('has no stable text until two revisions agree', () => {
    const stabilizer = new TranscriptStabilizer();

    expect(stabilizer.ingest(event('Good morning', 1))).toEqual({
      originalText: 'Good morning',
      stableText: '',
    });
  });

  it('stabilizes the word-complete prefix shared by consecutive revisions', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest(event('Good morning', 1));

    expect(stabilizer.ingest(event('Good morning everyone', 2))).toEqual({
      originalText: 'Good morning everyone',
      stableText: 'Good morning',
    });
  });

  it('never shrinks stable text when a revision retracts words', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest(event('Good morning', 1));
    stabilizer.ingest(event('Good morning everyone', 2));

    expect(stabilizer.ingest(event('Good mo', 3))).toMatchObject({
      stableText: 'Good morning',
    });
  });

  it('takes the final text verbatim even when it is shorter', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest(event('Good morning', 1));
    stabilizer.ingest(event('Good morning everyone', 2));

    expect(stabilizer.ingest(event('Good morning all.', 3, true))).toEqual({
      originalText: 'Good morning all.',
      stableText: 'Good morning all.',
    });
  });

  it('drops events that repeat or precede a revision already seen', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest(event('Good morning', 2));

    expect(stabilizer.ingest(event('Good', 1))).toBeUndefined();
  });

  it('drops events that arrive after the segment was finalized', () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.ingest(event('Good morning.', 5, true));

    expect(stabilizer.ingest(event('Good morning', 4))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/transcript-stabilizer.test.ts`
Expected: FAIL — received objects contain `translation` and no `stableText`.

- [ ] **Step 3: Write the implementation**

Replace the exported update type, the segment state, and `ingest` in `src/core/transcript-stabilizer.ts`. Keep `longestCommonPrefix` and `stableBoundary` exactly as they are; delete `TranslationPhrase` and `untranslatedSuffix`.

```ts
export interface StabilizedTranscriptUpdate {
  originalText: string;
  stableText: string;
}

interface SegmentState {
  lastRevision: number;
  lastText: string;
  stableText: string;
}

export class TranscriptStabilizer {
  private readonly segments = new Map<string, SegmentState>();
  private readonly finalizedRevisions = new Map<string, number>();

  ingest(event: TranscriptEvent): StabilizedTranscriptUpdate | undefined {
    const finalizedRevision = this.finalizedRevisions.get(event.segmentId);
    if (finalizedRevision !== undefined && event.revision <= finalizedRevision) {
      return undefined;
    }

    const existing = this.segments.get(event.segmentId);
    if (existing && event.revision <= existing.lastRevision) return undefined;

    const state: SegmentState = existing ?? {
      lastRevision: 0,
      lastText: '',
      stableText: '',
    };
    const candidate = event.isFinal
      ? event.text.trim()
      : stableBoundary(state.lastText, event.text);

    state.lastRevision = event.revision;
    state.lastText = event.text;
    state.stableText = event.isFinal
      ? candidate
      : candidate.length > state.stableText.length
        ? candidate
        : state.stableText;
    this.segments.set(event.segmentId, state);

    const update: StabilizedTranscriptUpdate = {
      originalText: event.text,
      stableText: state.stableText,
    };

    if (event.isFinal) {
      this.segments.delete(event.segmentId);
      this.finalizedRevisions.set(event.segmentId, event.revision);
    }
    return update;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/core/transcript-stabilizer.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/transcript-stabilizer.ts tests/core/transcript-stabilizer.test.ts
git commit -m "refactor: report full stable transcript text"
```

---

### Task 6: Controller sends the whole window

The controller replaces `CAPTION_ORIGINAL` and `CAPTION_TRANSLATION` with one `CAPTION_WINDOW` message, keys translations by unit id, and drops the `lastOriginal`/`lastTranslation` replay fields because the window itself is the replay.

**Files:**
- Modify: `src/core/capture-session-controller.ts`
- Test: `tests/core/capture-session-controller.test.ts`

- [ ] **Step 1: Write the failing test**

This file already has a `createHarness()` factory returning `{ controller, dependencies }`, a module-level `settings: SessionSettings` literal, and a pattern for recovering the session id from the `CAPTURE_START` message sent to `sendToOffscreen`. Use those; do not add a second harness. First extend the module-level `settings` literal with the three fields from Task 4:

```ts
const settings: SessionSettings = {
  backgroundOpacity: 78,
  bottomOffset: 8,
  deepgramApiKey: 'deepgram-key',
  deeplApiKey: 'deepl-key:fx',
  maxLineWidth: 90,
  sourceLanguage: 'EN',
  sourceLocale: 'en-US',
  targetLanguage: 'ZH-HANT',
  originalFontSize: 24,
  translationFontSize: 22,
};
```

Then add a local helper and the new tests:

```ts
async function startSession(
  harness: ReturnType<typeof createHarness>,
  overrides: Partial<SessionSettings> = {},
): Promise<string> {
  await harness.controller.start(42, { ...settings, ...overrides });
  const startMessage = vi
    .mocked(harness.dependencies.sendToOffscreen)
    .mock.calls.map(([message]) => message)
    .find((message) => message.type === 'CAPTURE_START')!;
  vi.mocked(harness.dependencies.sendToTab).mockClear();
  return (startMessage.payload as { sessionId: string }).sessionId;
}

function windowsSentTo(harness: ReturnType<typeof createHarness>) {
  return vi
    .mocked(harness.dependencies.sendToTab)
    .mock.calls.map(([, message]) => message)
    .filter(
      (message): message is Extract<TabMessage, { type: 'CAPTION_WINDOW' }> =>
        message.type === 'CAPTION_WINDOW',
    );
}

it('sends a rolling window that never holds more than two units', async () => {
  const harness = createHarness();
  vi.mocked(harness.dependencies.translate).mockImplementation(
    async (_sessionId, request) => `[${request.text}]`,
  );
  const sessionId = await startSession(harness, { maxLineWidth: 20 });

  await harness.controller.acceptTranscript(sessionId, {
    isFinal: false,
    revision: 1,
    segmentId: 'segment-1',
    text: 'Hello there.',
  });
  await harness.controller.acceptTranscript(sessionId, {
    isFinal: false,
    revision: 2,
    segmentId: 'segment-1',
    text: 'Hello there. And now we',
  });
  await harness.controller.acceptTranscript(sessionId, {
    isFinal: false,
    revision: 3,
    segmentId: 'segment-1',
    text: 'Hello there. And now we go. Then more text arrives',
  });

  const windows = windowsSentTo(harness);
  expect(windows.length).toBeGreaterThan(0);
  for (const message of windows) {
    expect(message.payload.pairs.length).toBeLessThanOrEqual(2);
  }
  expect(
    vi.mocked(harness.dependencies.translate).mock.calls.map(
      ([, request]) => request.text,
    ),
  ).toContain('Hello there.');
});

it('translates each unit under its own key so pairs stay aligned', async () => {
  const harness = createHarness();
  vi.mocked(harness.dependencies.translate).mockImplementation(
    async (_sessionId, request) => `[${request.text}]`,
  );
  const sessionId = await startSession(harness, { maxLineWidth: 20 });

  await harness.controller.acceptTranscript(sessionId, {
    isFinal: false,
    revision: 1,
    segmentId: 'segment-1',
    text: 'Hello there.',
  });
  await harness.controller.acceptTranscript(sessionId, {
    isFinal: true,
    revision: 2,
    segmentId: 'segment-1',
    text: 'Hello there. And now.',
  });

  const pairs = windowsSentTo(harness).at(-1)!.payload.pairs;
  expect(pairs).toEqual([
    { id: 'segment-1#0', original: 'Hello there.', translation: '[Hello there.]' },
    { id: 'segment-1#1', original: 'And now.', translation: '[And now.]' },
  ]);
});

it('replays the current window when the content script reports ready', async () => {
  const harness = createHarness();
  const sessionId = await startSession(harness);
  await harness.controller.acceptTranscript(sessionId, {
    isFinal: false,
    revision: 1,
    segmentId: 'segment-1',
    text: 'Hello there.',
  });
  vi.mocked(harness.dependencies.sendToTab).mockClear();

  await harness.controller.handleContentReady(42);

  const types = vi
    .mocked(harness.dependencies.sendToTab)
    .mock.calls.map(([, message]) => message.type);
  expect(types).toContain('OVERLAY_SHOW');
  expect(types).toContain('CAPTION_WINDOW');
});

it('applies a new line width to units that arrive afterwards', async () => {
  const harness = createHarness();
  const sessionId = await startSession(harness, { maxLineWidth: 140 });
  harness.controller.applyLayout(20);

  await harness.controller.acceptTranscript(sessionId, {
    isFinal: true,
    revision: 1,
    segmentId: 'segment-1',
    text: 'One two three four five six seven eight nine ten.',
  });

  const pairs = windowsSentTo(harness).at(-1)!.payload.pairs;
  expect(pairs).toHaveLength(2);
  for (const pair of pairs) expect(pair.original.length).toBeLessThanOrEqual(20);
});
```

Import `TabMessage` as a type alongside the existing imports from `../../src/core/capture-session-controller`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/capture-session-controller.test.ts`
Expected: FAIL — no `CAPTION_WINDOW` message is ever sent.

- [ ] **Step 3: Write the implementation**

In `src/core/capture-session-controller.ts`:

Replace the caption entries of `TabMessage` and drop the `OVERLAY_SHOW` payload:

```ts
export type TabMessage =
  | { type: 'CONTENT_PING' }
  | { type: 'OVERLAY_SHOW' }
  | { type: 'OVERLAY_HIDE' }
  | { type: 'CAPTION_WINDOW'; payload: { pairs: CaptionPair[] } }
  | { type: 'SESSION_ERROR'; payload: { code: string } }
  | { type: 'SESSION_ERROR_CLEAR' };
```

Add the imports:

```ts
import { CaptionChunker, type CaptionUnit } from './caption-chunker';
import { CaptionWindow, type CaptionPair } from './caption-window';
```

Replace the `lastOriginal` and `lastTranslation` fields with:

```ts
  private readonly captionWindow = new CaptionWindow();
  private readonly chunker = new CaptionChunker();
```

Delete every remaining reference to `lastOriginal` and `lastTranslation` in `restore`, `startInternal`, and `stopInternal`, and reset the new collaborators in the same places those fields were reset:

```ts
    this.captionWindow.clear();
    this.chunker.clear();
```

Replace `acceptTranscript` with:

```ts
  async acceptTranscript(
    sessionId: string,
    event: TranscriptEvent,
  ): Promise<void> {
    if (
      sessionId !== this.activeSessionId ||
      this.currentStatus.state !== 'running' ||
      !this.settings ||
      !this.translationCoordinator
    ) {
      return;
    }
    const tabId = this.currentStatus.tabId;
    const generation = this.generation;
    const update = this.stabilizer.ingest(event);
    if (!update) return;

    const units = this.chunker.ingest({
      isFinal: event.isFinal,
      maxWidth: this.settings.maxLineWidth,
      rawText: update.originalText,
      segmentId: event.segmentId,
      stableText: update.stableText,
    });
    if (units.length === 0) return;

    for (const unit of units) {
      this.captionWindow.upsertOriginal(unit.id, unit.displayText);
    }
    await this.sendWindow(tabId);
    if (this.currentStatus.error === 'translation_disabled') return;

    for (const unit of units) {
      if (!unit.translateText) continue;
      await this.translateUnit(unit, event.revision, tabId, generation);
    }
  }

  private async sendWindow(tabId: number): Promise<void> {
    await this.dependencies.sendToTab(tabId, {
      type: 'CAPTION_WINDOW',
      payload: { pairs: this.captionWindow.pairs() },
    });
  }
```

Add `translateUnit`, moving the body of the old translation `try`/`catch` into it unchanged apart from the key and the success path:

```ts
  private async translateUnit(
    unit: CaptionUnit,
    revision: number,
    tabId: number,
    generation: number,
  ): Promise<void> {
    const attemptId = ++this.translationAttemptSequence;
    let result: CoordinatedTranslation | undefined;
    try {
      result = await this.translationCoordinator!.translate({
        revision,
        segmentId: unit.id,
        text: unit.translateText,
      });
    } catch (error) {
      if (
        generation === this.generation &&
        this.currentStatus.state === 'running'
      ) {
        const code = translationFailureCode(error);
        if (
          attemptId < this.lastSuccessfulTranslationAttemptId ||
          (this.currentTranslationErrorAttemptId !== undefined &&
            attemptId < this.currentTranslationErrorAttemptId)
        ) {
          return;
        }
        const shouldNotify =
          code !== 'translation_disabled' ||
          this.currentStatus.error !== 'translation_disabled';
        this.currentTranslationErrorAttemptId = attemptId;
        this.currentStatus = { error: code, state: 'running', tabId };
        if (shouldNotify) {
          await this.dependencies.sendToTab(tabId, {
            type: 'SESSION_ERROR',
            payload: { code },
          });
        }
      }
      return;
    }
    if (
      !result ||
      generation !== this.generation ||
      this.currentStatus.state !== 'running'
    ) {
      return;
    }
    this.lastSuccessfulTranslationAttemptId = Math.max(
      this.lastSuccessfulTranslationAttemptId,
      attemptId,
    );
    const clearsCurrentError =
      Boolean(this.currentStatus.error) &&
      this.currentStatus.error !== 'translation_disabled' &&
      this.currentTranslationErrorAttemptId !== undefined &&
      attemptId > this.currentTranslationErrorAttemptId;
    if (clearsCurrentError) {
      this.currentTranslationErrorAttemptId = undefined;
      this.currentStatus = { state: 'running', tabId };
      await this.dependencies.sendToTab(tabId, { type: 'SESSION_ERROR_CLEAR' });
    }
    this.captionWindow.upsertTranslation(unit.id, result.text);
    await this.sendWindow(tabId);
  }
```

Change the two `OVERLAY_SHOW` sends (in `startInternal` and `handleContentReady`) to carry no payload, and replace the replay block in `handleContentReady` with:

```ts
    await this.dependencies.sendToTab(tabId, { type: 'OVERLAY_SHOW' });
    await this.sendWindow(tabId);
```

Add the live layout hook used by Task 11:

```ts
  applyLayout(maxLineWidth: number): void {
    if (this.settings) this.settings = { ...this.settings, maxLineWidth };
  }
```

- [ ] **Step 4: Fix the rest of the suite and run it**

Every existing assertion on `CAPTION_ORIGINAL`, `CAPTION_TRANSLATION`, or an `OVERLAY_SHOW` payload must be rewritten against `CAPTION_WINDOW`, and every `SessionSettings` literal in the tests needs the three new fields (use `normalizeSettings({})` where a full object is needed).

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/capture-session-controller.ts tests/core/capture-session-controller.test.ts tests/entrypoints/background.test.ts
git commit -m "feat: send a rolling caption window to the overlay"
```

---

### Task 7: Overlay renders the window

The overlay stops accumulating translations and becomes a renderer: it diffs the incoming window against the DOM, keyed by `data-pair-id`. Animation arrives in Task 8. This task also fixes the wrapping CSS the user reported: `text-wrap: balance` fights one-line units and `overflow-wrap: anywhere` breaks English words mid-word.

**Files:**
- Modify: `src/content/caption-overlay.ts`
- Test: `tests/content/caption-overlay.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the `renders isolated bilingual captions…` and `appends stable translation chunks…` tests with:

```ts
const appearance = {
  backgroundOpacity: 50,
  bottomOffset: 12,
  originalFontSize: 30,
  translationFontSize: 20,
};

function pairsOf(document: Document) {
  const host = document.querySelector('[data-bilingual-caption-root]');
  const track = host?.shadowRoot?.querySelector('.track');
  return [...(track?.children ?? [])].map((pair) => ({
    id: (pair as HTMLElement).dataset.pairId,
    original: pair.querySelector('.original')?.textContent,
    translation: pair.querySelector('.translation')?.textContent,
  }));
}

it('renders one element per window unit with both lines', () => {
  const overlay = new CaptionOverlay(document);
  overlay.show(appearance);
  overlay.setWindow([
    { id: 'a', original: 'Hello there.', translation: '你好。' },
    { id: 'b', original: 'And now.', translation: '接下來。' },
  ]);

  expect(pairsOf(document)).toEqual([
    { id: 'a', original: 'Hello there.', translation: '你好。' },
    { id: 'b', original: 'And now.', translation: '接下來。' },
  ]);
});

it('applies appearance settings as CSS variables', () => {
  const overlay = new CaptionOverlay(document);
  overlay.show(appearance);
  const host = document.querySelector<HTMLElement>('[data-bilingual-caption-root]');

  expect(host?.style.getPropertyValue('--caption-original-size')).toBe('30px');
  expect(host?.style.getPropertyValue('--caption-translation-size')).toBe('20px');
  expect(host?.style.getPropertyValue('--caption-bg-opacity')).toBe('0.5');
  expect(host?.style.getPropertyValue('--caption-bottom-offset')).toBe('12%');
});

it('updates a unit in place without recreating its element', () => {
  const overlay = new CaptionOverlay(document);
  overlay.show(appearance);
  overlay.setWindow([{ id: 'a', original: 'Hello', translation: '' }]);
  const host = document.querySelector('[data-bilingual-caption-root]');
  const before = host?.shadowRoot?.querySelector('.track')?.firstElementChild;

  overlay.setWindow([{ id: 'a', original: 'Hello there', translation: '你好' }]);

  expect(host?.shadowRoot?.querySelector('.track')?.firstElementChild).toBe(before);
  expect(pairsOf(document)).toEqual([
    { id: 'a', original: 'Hello there', translation: '你好' },
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/content/caption-overlay.test.ts`
Expected: FAIL — `overlay.setWindow is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/content/caption-overlay.ts`:

Replace `CaptionSizes` and `OverlayTranslation` with:

```ts
import type { CaptionPair } from '../core/caption-window';

export interface CaptionAppearance {
  backgroundOpacity: number;
  bottomOffset: number;
  originalFontSize: number;
  translationFontSize: number;
}
```

Update `OVERLAY_CSS`: give `.stage` a variable bottom pad, make the box background use the opacity variable, add the viewport/track/pair rules, and fix the wrapping properties.

```css
  .stage { padding: 0 5% var(--caption-bottom-offset, 8%); }
  .captions {
    background: rgba(3, 7, 18, var(--caption-bg-opacity, 0.78));
    /* keep every other existing .captions declaration, but delete
       text-wrap: balance */
  }
  .viewport {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    overflow: hidden;
  }
  .track { display: flex; flex-direction: column; }
  .pair { padding: 2px 0; }
  .original {
    font-size: var(--caption-original-size, 24px);
    font-weight: 650;
    overflow-wrap: break-word;
    text-shadow: 0 1px 2px #000;
  }
  .translation {
    color: #fde68a;
    font-size: var(--caption-translation-size, 22px);
    font-weight: 550;
    margin-top: 3px;
    overflow-wrap: break-word;
    text-shadow: 0 1px 2px #000;
  }
```

Replace the class fields, `show`, `hide`, `setSizes`, `setOriginal`, `setTranslation`, `translationText`, and `syncNativeCue`:

```ts
export class CaptionOverlay {
  private appearance?: CaptionAppearance;
  private host?: HTMLElement;
  private nativeCue?: VTTCue;
  private nativeTrack?: TextTrack;
  private nativeVideo?: HTMLVideoElement;
  private pairs: CaptionPair[] = [];
  private readonly pairElements = new Map<string, HTMLElement>();
  private statusElement?: HTMLElement;
  private statusTextValue = '';
  private trackElement?: HTMLElement;
  private viewportElement?: HTMLElement;

  constructor(private readonly document: Document) {}

  show(appearance: CaptionAppearance): void {
    if (!this.host) this.createHost();
    this.setAppearance(appearance);
    this.position();
  }

  hide(): void {
    this.disableNativeTextTrack();
    this.host?.remove();
    this.host = undefined;
    this.statusElement = undefined;
    this.trackElement = undefined;
    this.viewportElement = undefined;
    this.pairElements.clear();
    this.pairs = [];
    this.statusTextValue = '';
  }

  setAppearance(appearance: CaptionAppearance): void {
    this.appearance = appearance;
    const style = this.host?.style;
    if (!style) return;
    style.setProperty(
      '--caption-original-size',
      `${appearance.originalFontSize}px`,
    );
    style.setProperty(
      '--caption-translation-size',
      `${appearance.translationFontSize}px`,
    );
    style.setProperty(
      '--caption-bg-opacity',
      `${appearance.backgroundOpacity / 100}`,
    );
    style.setProperty('--caption-bottom-offset', `${appearance.bottomOffset}%`);
  }

  setWindow(pairs: CaptionPair[]): void {
    this.pairs = pairs;
    this.syncNativeCue();
    const track = this.trackElement;
    if (!track) return;

    const incoming = new Set(pairs.map((pair) => pair.id));
    const outgoing = [...track.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !incoming.has(child.dataset.pairId ?? ''),
    );

    let appended = false;
    for (const pair of pairs) {
      const existing = this.pairElements.get(pair.id);
      if (existing) {
        this.writePair(existing, pair);
        continue;
      }
      const element = this.createPair(pair);
      track.append(element);
      this.pairElements.set(pair.id, element);
      appended = true;
    }

    if (outgoing.length === 0) return;
    this.removePairs(outgoing);
  }

  private createPair(pair: CaptionPair): HTMLElement {
    const element = this.document.createElement('div');
    element.className = 'pair';
    element.dataset.pairId = pair.id;
    const original = this.document.createElement('div');
    original.className = 'original';
    const translation = this.document.createElement('div');
    translation.className = 'translation';
    element.append(original, translation);
    this.writePair(element, pair);
    return element;
  }

  private writePair(element: HTMLElement, pair: CaptionPair): void {
    const original = element.querySelector('.original');
    const translation = element.querySelector('.translation');
    if (original) original.textContent = pair.original;
    if (translation) translation.textContent = pair.translation;
  }

  private removePairs(elements: HTMLElement[]): void {
    for (const element of elements) {
      const id = element.dataset.pairId;
      if (id) this.pairElements.delete(id);
      element.remove();
    }
  }

  private syncNativeCue(): void {
    if (!this.nativeCue) return;
    this.nativeCue.text = [
      ...this.pairs.flatMap((pair) => [pair.original, pair.translation]),
      this.statusTextValue,
    ]
      .filter(Boolean)
      .join('\n');
  }
}
```

In `createHost`, build the viewport and track instead of the two bare text elements:

```ts
    const viewport = this.document.createElement('div');
    viewport.className = 'viewport';
    const track = this.document.createElement('div');
    track.className = 'track';
    viewport.append(track);
    const status = this.document.createElement('div');
    status.className = 'status-message';
    status.textContent = this.statusTextValue;
    captions.append(viewport, status);
```

and record the new references, dropping `originalElement`/`translationElement`:

```ts
    this.statusElement = status;
    this.trackElement = track;
    this.viewportElement = viewport;
    for (const pair of this.pairs) {
      const element = this.createPair(pair);
      track.append(element);
      this.pairElements.set(pair.id, element);
    }
```

Keep `setSessionError`, `clearSessionError`, `position`, `enableNativeTextTrack`, and `disableNativeTextTrack` as they are. Delete the `.original:empty, .translation:empty` rule's reference to elements that no longer exist only if it breaks — it is harmless to keep.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/content/caption-overlay.test.ts && npx tsc --noEmit`
Expected: overlay tests PASS. `tsc` still fails in `entrypoints/captions.content.ts`, which Task 9 rewrites.

- [ ] **Step 5: Commit**

```bash
git add src/content/caption-overlay.ts tests/content/caption-overlay.test.ts
git commit -m "feat: render the caption window as unit pairs"
```

---

### Task 8: Push animation

The track is bottom-aligned, so appending a unit moves the existing units up and removing the top unit moves nothing. The slide distance is the measured height of the outgoing element, so no CSS height arithmetic can drift out of sync with the real layout. The push runs only when a unit was both added and dropped; going from one unit to two just grows the box.

**Files:**
- Modify: `src/content/caption-overlay.ts`
- Test: `tests/content/caption-overlay.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('slides the track up and removes the outgoing unit when the window is full', async () => {
  vi.useFakeTimers();
  try {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance);
    overlay.setWindow([
      { id: 'a', original: 'A', translation: '甲' },
      { id: 'b', original: 'B', translation: '乙' },
    ]);

    overlay.setWindow([
      { id: 'b', original: 'B', translation: '乙' },
      { id: 'c', original: 'C', translation: '丙' },
    ]);

    const host = document.querySelector('[data-bilingual-caption-root]');
    const track = host?.shadowRoot?.querySelector<HTMLElement>('.track');
    expect(pairsOf(document).map((pair) => pair.id)).toEqual(['a', 'b', 'c']);
    expect(track?.classList.contains('instant')).toBe(true);

    await vi.advanceTimersByTimeAsync(400);

    expect(pairsOf(document).map((pair) => pair.id)).toEqual(['b', 'c']);
    expect(track?.classList.contains('instant')).toBe(false);
    expect(track?.style.transform).toBe('');
  } finally {
    vi.useRealTimers();
  }
});

it('drops the outgoing unit immediately when motion is reduced', () => {
  const matchMedia = vi.fn().mockReturnValue({ matches: true });
  vi.stubGlobal('matchMedia', matchMedia);
  try {
    const overlay = new CaptionOverlay(document);
    overlay.show(appearance);
    overlay.setWindow([
      { id: 'a', original: 'A', translation: '甲' },
      { id: 'b', original: 'B', translation: '乙' },
    ]);

    overlay.setWindow([
      { id: 'b', original: 'B', translation: '乙' },
      { id: 'c', original: 'C', translation: '丙' },
    ]);

    expect(pairsOf(document).map((pair) => pair.id)).toEqual(['b', 'c']);
  } finally {
    vi.unstubAllGlobals();
  }
});
```

Add `vi` to the `vitest` import in this file if it is not already there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/content/caption-overlay.test.ts`
Expected: FAIL — the outgoing unit is removed synchronously, so the first assertion sees `['b', 'c']`.

- [ ] **Step 3: Write the implementation**

Add the duration constant next to `OVERLAY_CSS`:

```ts
const PUSH_DURATION_MS = 220;
```

Add the transition rules to `OVERLAY_CSS`, replacing the existing `@media (prefers-reduced-motion: no-preference)` block:

```css
  .track.instant { transition: none; }
  @media (prefers-reduced-motion: no-preference) {
    .captions { transition: opacity 160ms ease-out; }
    .track { transition: transform 220ms ease-out; }
  }
```

In `setWindow`, replace the tail (`if (outgoing.length === 0) return; this.removePairs(outgoing);`) with:

```ts
    if (outgoing.length === 0) return;
    if (!appended || this.prefersReducedMotion()) {
      this.removePairs(outgoing);
      return;
    }
    this.animatePush(outgoing);
```

Add the two private methods:

```ts
  private prefersReducedMotion(): boolean {
    const view = this.document.defaultView;
    return (
      view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    );
  }

  private animatePush(outgoing: HTMLElement[]): void {
    const track = this.trackElement;
    const viewport = this.viewportElement;
    if (!track || !viewport) {
      this.removePairs(outgoing);
      return;
    }
    const distance = outgoing.reduce(
      (total, element) => total + element.offsetHeight,
      0,
    );
    const pinnedHeight = viewport.offsetHeight;
    if (pinnedHeight > 0) viewport.style.height = `${pinnedHeight}px`;
    track.classList.add('instant');
    track.style.transform = `translateY(${distance}px)`;
    void track.offsetHeight;

    const view = this.document.defaultView;
    const release = () => {
      track.classList.remove('instant');
      track.style.transform = '';
    };
    if (view?.requestAnimationFrame) view.requestAnimationFrame(release);
    else release();

    const finish = () => {
      this.removePairs(outgoing);
      release();
      viewport.style.height = '';
    };
    if (view?.setTimeout) view.setTimeout(finish, PUSH_DURATION_MS + 40);
    else finish();
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/content/caption-overlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/caption-overlay.ts tests/content/caption-overlay.test.ts
git commit -m "feat: animate the caption window push"
```

---

### Task 9: Content script reads appearance from storage

Appearance lives in `chrome.storage.local`, so dragging a slider updates a running session without any new message type.

**Files:**
- Modify: `entrypoints/captions.content.ts`

- [ ] **Step 1: Write the implementation**

Replace the imports, add the appearance reader and the storage subscription, and rewrite the two caption cases:

```ts
import type { TabMessage } from '../src/core/capture-session-controller';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AppSettings,
} from '../src/core/settings';
import {
  CaptionOverlay,
  type CaptionAppearance,
} from '../src/content/caption-overlay';
```

Inside `main()`, after the overlay is created:

```ts
    const readAppearance = async (): Promise<CaptionAppearance> => {
      const stored = await chrome.storage.local.get('settings');
      const settings = normalizeSettings(
        (stored.settings as Partial<AppSettings> | undefined) ??
          DEFAULT_SETTINGS,
      );
      return {
        backgroundOpacity: settings.backgroundOpacity,
        bottomOffset: settings.bottomOffset,
        originalFontSize: settings.originalFontSize,
        translationFontSize: settings.translationFontSize,
      };
    };

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      void readAppearance().then((appearance) =>
        overlay.setAppearance(appearance),
      );
    });
```

and replace the `OVERLAY_SHOW`, `CAPTION_ORIGINAL`, and `CAPTION_TRANSLATION` cases with:

```ts
        case 'OVERLAY_SHOW':
          void readAppearance().then((appearance) => overlay.show(appearance));
          break;
        case 'CAPTION_WINDOW':
          overlay.setWindow(message.payload.pairs);
          break;
```

- [ ] **Step 2: Verify the build and the whole suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: no type errors, all tests pass, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add entrypoints/captions.content.ts
git commit -m "feat: apply caption appearance from stored settings"
```

---

### Task 10: Popup sliders for the three settings

**Files:**
- Modify: `src/popup/PopupApp.tsx`
- Test: `tests/popup/popup-app.test.tsx`

- [ ] **Step 1: Write the failing test**

This file already has a `createApi(overrides)` factory and renders with
`render(<PopupApp api={createApi()} />)`. Saved values are asserted through the
`saveSettings` mock. Add:

```tsx
it('saves each layout setting when its slider moves', async () => {
  const api = createApi();
  render(<PopupApp api={api} />);

  fireEvent.change(await screen.findByLabelText('每行長度上限'), {
    target: { value: '60' },
  });
  await waitFor(() =>
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ maxLineWidth: 60 }),
    ),
  );

  fireEvent.change(screen.getByLabelText('背景透明度'), {
    target: { value: '30' },
  });
  await waitFor(() =>
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ backgroundOpacity: 30 }),
    ),
  );

  fireEvent.change(screen.getByLabelText('距底部位置'), {
    target: { value: '20' },
  });
  await waitFor(() =>
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ bottomOffset: 20 }),
    ),
  );
});

it('keeps the layout sliders usable while a session runs', async () => {
  render(
    <PopupApp
      api={createApi({
        status: vi.fn().mockResolvedValue({ state: 'running', tabId: 42 }),
      })}
    />,
  );

  expect(await screen.findByLabelText('背景透明度')).toBeEnabled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/popup/popup-app.test.tsx`
Expected: FAIL — unable to find a label `每行長度上限`.

- [ ] **Step 3: Write the implementation**

Give `RangeField` its bounds and unit as props:

```tsx
function RangeField({
  id,
  label,
  max,
  min,
  onChange,
  step = 1,
  unit,
  value,
}: {
  id: string;
  label: string;
  max: number;
  min: number;
  onChange(value: number): void;
  step?: number;
  unit: string;
  value: number;
}) {
  return (
    <div className="range-field">
      <div className="range-label">
        <label htmlFor={id}>{label}</label>
        <output>{`${value}${unit}`}</output>
      </div>
      <input
        id={id}
        max={max}
        min={min}
        step={step}
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
```

Import `SETTING_RANGES` from `../core/settings`, then pass bounds to the two existing sliders (`unit="px"`, `min={SETTING_RANGES.originalFontSize.min}`, `max={SETTING_RANGES.originalFontSize.max}` and the matching pair for the translation size), and add a new card after the 字幕大小 section:

```tsx
      <section className="card" aria-labelledby="layout-heading">
        <h2 id="layout-heading">字幕版面</h2>
        <RangeField
          id="max-line-width"
          label="每行長度上限"
          max={SETTING_RANGES.maxLineWidth.max}
          min={SETTING_RANGES.maxLineWidth.min}
          step={5}
          unit=" 字寬"
          value={settings.maxLineWidth}
          onChange={(value) => update('maxLineWidth', value)}
        />
        <RangeField
          id="background-opacity"
          label="背景透明度"
          max={SETTING_RANGES.backgroundOpacity.max}
          min={SETTING_RANGES.backgroundOpacity.min}
          step={5}
          unit="%"
          value={settings.backgroundOpacity}
          onChange={(value) => update('backgroundOpacity', value)}
        />
        <RangeField
          id="bottom-offset"
          label="距底部位置"
          max={SETTING_RANGES.bottomOffset.max}
          min={SETTING_RANGES.bottomOffset.min}
          unit="%"
          value={settings.bottomOffset}
          onChange={(value) => update('bottomOffset', value)}
        />
      </section>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/popup/popup-app.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/popup/PopupApp.tsx tests/popup/popup-app.test.tsx
git commit -m "feat: add caption layout sliders to the popup"
```

---

### Task 11: Live line-width updates in the background

**Files:**
- Modify: `entrypoints/background.ts`
- Test: `tests/entrypoints/background.test.ts`

- [ ] **Step 1: Write the failing test**

This file boots the background entrypoint in a `beforeEach` that calls
`vi.stubGlobal('chrome', {...})` and captures the message listener into a
module-level `listener` variable. Its `chrome` stub has no `storage.onChanged`,
so add one and capture the registered callback the same way:

```ts
let onSettingsChanged: (
  changes: Record<string, { newValue?: unknown }>,
  area: string,
) => void;
```

In the `chrome` stub's `storage` object, add:

```ts
      onChanged: {
        addListener: vi.fn(
          (
            callback: (
              changes: Record<string, { newValue?: unknown }>,
              area: string,
            ) => void,
          ) => {
            onSettingsChanged = callback;
          },
        ),
      },
```

Extend the module-level `settings: AppSettings` literal with the three fields
from Task 4 (`backgroundOpacity: 78`, `bottomOffset: 8`, `maxLineWidth: 90`),
then add:

```ts
it('registers a settings listener that survives an unrelated storage change', () => {
  expect(onSettingsChanged).toBeTypeOf('function');

  expect(() => {
    onSettingsChanged({ other: { newValue: 1 } }, 'local');
    onSettingsChanged({ settings: { newValue: { maxLineWidth: 55 } } }, 'sync');
    onSettingsChanged({ settings: { newValue: { maxLineWidth: 55 } } }, 'local');
    onSettingsChanged({ settings: {} }, 'local');
  }).not.toThrow();
});
```

The behavior that a changed width reaches the chunker is covered by the
`applies a new line width to units that arrive afterwards` test in Task 6,
where the controller is directly reachable. This test only proves the wiring
exists and tolerates the change shapes Chrome actually delivers.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/entrypoints/background.test.ts`
Expected: FAIL — `onSettingsChanged` is undefined because the background never
registers a `chrome.storage.onChanged` listener.

- [ ] **Step 3: Write the implementation**

In `entrypoints/background.ts`, add after the `chrome.tabs.onRemoved` listener:

```ts
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const next = normalizeSettings(
      (changes.settings.newValue as Partial<AppSettings> | undefined) ?? {},
    );
    controller.applyLayout(next.maxLineWidth);
  });
```

and extend the existing `normalizeSettings` import to also bring in the type:

```ts
import { normalizeSettings, type AppSettings } from '../src/core/settings';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/background.ts tests/entrypoints/background.test.ts
git commit -m "feat: apply line width changes to a running session"
```

---

### Task 12: Verify in a real browser

Unit tests cannot show that four lines actually fit, that the slide reads as a push, or that the sliders feel right. Chrome 150 ignores `--load-extension`, so use Playwright's bundled Chromium.

**Files:**
- None committed. The driver script lives in the scratchpad.

- [ ] **Step 1: Build the extension**

Run: `npm run build`
Expected: `output/chrome-mv3` written with no errors.

- [ ] **Step 2: Launch Chromium with the extension and a persistent profile**

Write a driver script that calls
`chromium.launchPersistentContext(profileDir, { headless: false, viewport: null, args: ['--disable-extensions-except=<abs path to output/chrome-mv3>', '--load-extension=<same path>', '--no-first-run', '--no-default-browser-check'] })`,
takes the extension id from `context.serviceWorkers()[0].url()`, and opens
`https://www.youtube.com/watch?v=DmoyA3HCPHc`. Reuse the same profile directory across runs so the API keys entered once are still there.

- [ ] **Step 3: Start a session and watch the overlay**

Enter both API keys on `chrome-extension://<id>/options.html` if the profile is new, then start captions from the popup on the YouTube tab.

Confirm by eye:
- at most two units are visible, four lines total, in original/translation/original/translation order;
- a new unit pushes the older pair upward with visible motion rather than a jump;
- the box does not grow beyond two units;
- the third line grows word by word while a sentence is still being spoken.

- [ ] **Step 4: Exercise the three sliders during a live session**

Drag each slider in the popup while captions are running and confirm the overlay reacts without a restart: line width changes the length of newly arriving units, opacity changes the box background, and the position slider moves the box vertically.

- [ ] **Step 5: Record the outcome**

Note anything that looked wrong. Do not claim this task complete on the strength of passing unit tests — this task is specifically the human-visible check.

---

## Notes for the implementer

- `CaptionWindow.upsertOriginal` mutates the stored entry, and `pairs()` returns copies. Keep it that way: the controller sends `pairs()` straight into a message, and a shared mutable reference would let the payload change after it was sent.
- The chunker relies on stabilized text being a prefix of the raw interim text. That is why greedy left-to-right packing matters — it makes closed unit boundaries depend only on the prefix, so they never move.
- Do not reintroduce `mode: 'append' | 'replace'`. The background now owns accumulation, and the window message is idempotent by design.
