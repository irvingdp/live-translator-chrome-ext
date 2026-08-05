# Rolling Caption Window Design

## Problem

The overlay shows one Deepgram segment at a time. A segment is a whole
utterance, so its text keeps growing until the speaker pauses. The original
element wraps to five or more lines, the translation wraps to two or three, and
the caption box covers a large part of the video. Because the translation is
accumulated per segment and re-sent as one string, DeepL also re-translates the
whole accumulated segment on every stable phrase.

The overlay must instead show a rolling window of two display units. Each unit
is one line of source text and one line of its translation, so four lines are
visible. When a new unit arrives, the oldest unit leaves the top and the
remaining unit slides up with an animation.

## Goals

- Show at most two units, each rendered as one original line and one
  translation line.
- Cut the transcript into display units of roughly one line instead of whole
  utterances.
- Translate per display unit so each DeepL request stays small.
- Slide the window upward when a new unit arrives.
- Keep the in-progress unit live: its original grows word by word and its
  translation fills in as soon as it arrives.
- Let the user adjust maximum line width, background opacity, and vertical
  position, and apply those changes to a running session.

## Non-goals

- Changing the Deepgram request parameters or the audio pipeline.
- Changing the retry or circuit-breaker semantics.
- Horizontal position control or drag-to-move (vertical offset only).
- Auto-shrinking the font to force text onto one line.
- Truncating text with an ellipsis. Content is never dropped.

## Architecture

Chunking happens in the background service worker, not in the content script.
The translation of a unit must correspond to exactly one source unit, and a
translated Chinese string cannot be split back into source-aligned pieces in
the content script.

Data flow:

```
Deepgram → TranscriptStabilizer (existing)   stable text
         → CaptionChunker (new)              display units
         → CaptionWindow (new)               last two units
         → CAPTION_WINDOW message            → CaptionOverlay (renders, animates)
```

### CaptionChunker

`CaptionChunker` turns the stabilized text of a segment into display units. It
holds, per segment, the units it has already closed.

Boundary rules, applied in order:

1. Split at sentence-final punctuation: `.`, `?`, `!`, `。`, `！`, `？`, `…`.
   Punctuation stays with the preceding unit.
2. Split any piece wider than the limit at clause punctuation: `,`, `;`, `:`,
   `，`, `、`, `；`, `：`.
3. Split any remaining over-wide piece at the last word boundary before the
   limit. Text without spaces is cut at the limit.

Width is a visual estimate, not a character count: a character in the CJK,
fullwidth, Hiragana, or Katakana ranges counts as 2, every other character
counts as 1. One rule then serves both Latin and CJK source languages. The
limit is the `maxLineWidth` setting.

Boundaries are computed only from stabilized text, and a closed unit's text is
frozen. Deepgram revises interim results, so freezing a boundary derived from
unstable text would let a later revision contradict text that has already been
shown. Units therefore only ever move forward.

Each unit gets an id of `<segmentId>#<index>`, which makes it a stable key for
translation and for window updates.

### The in-progress unit

The last unit of a non-final segment stays open.

- Its **displayed original** is the raw interim text minus the prefix already
  covered by closed units. The chunker tracks a `closedPrefixLength` per
  segment, the total length of that segment's closed unit text within the raw
  text; the open unit displays `rawText.slice(closedPrefixLength).trim()`. This
  is well defined because stabilized text is always a prefix of the raw interim
  text. It grows word by word, so the third line tracks speech with minimal
  delay.
- Its **translated text** is the stabilized part of that unit only. The
  translation updates as the stable text grows, so the fourth line fills in and
  then refines.

When interim text arrives faster than the stabilizer can confirm it and no
punctuation appears, the open unit can briefly exceed one line and wrap, making
five lines. It corrects itself when the stable text catches up and the unit
closes. Wrapping is preferred over an ellipsis because no content may be lost.

### CaptionWindow

`CaptionWindow` holds the last two units in arrival order:

- `upsertOriginal(id, text)` adds or updates a unit, dropping the oldest when a
  third arrives.
- `upsertTranslation(id, text)` updates a unit's translation and ignores
  translations for units that have already been dropped.
- `pairs()` returns at most two `{ id, original, translation }` entries, oldest
  first.

### Message protocol

`CAPTION_ORIGINAL` and `CAPTION_TRANSLATION` are removed and replaced by a
single message carrying the whole window:

```ts
{ type: 'CAPTION_WINDOW'; payload: { pairs: CaptionPair[] } }
```

The background owns the window state and sends the complete window on every
change. The payload is a few hundred bytes, and every update is idempotent, so
out-of-order translation results cannot corrupt the display and replay after a
content-script re-injection is just another send. This also removes the
`mode: 'append' | 'replace'` accumulation and the per-segment translation map
from `CaptionOverlay`, which becomes a pure renderer.

`handleContentReady` re-sends the current window instead of replaying a stored
original and translation.

### Overlay rendering and animation

The caption box gains a clipping viewport around a bottom-aligned track:

- `.viewport` has `overflow: hidden` and `max-height` of two unit heights, both
  derived from the font-size variables. Its height follows its content, so it is
  one unit tall until the second unit arrives and clips at two thereafter.
- `.track` is a bottom-aligned flex column of unit elements, each holding one
  `.original` and one `.translation` line.

Because the track is bottom-aligned, appending a unit moves the existing units
up and removing the top unit moves nothing.

The push animation runs only when the window was already full. Going from one
unit to two grows the viewport instead and needs no slide; there is nothing
above to push out. A push is therefore:

1. Append the new unit. Existing units jump up by one unit height.
2. Immediately set `transform: translateY(<unit height>)` with no transition,
   which visually undoes the jump.
3. On the next animation frame, clear the transform with a transition. The
   track slides up.
4. On `transitionend`, remove the oldest unit. Nothing moves.

The unit height comes from a CSS variable derived from the two font sizes, so
no DOM measurement is required and the behavior is assertable in jsdom.
`prefers-reduced-motion: reduce` skips the transition, matching the existing
overlay CSS.

The box grows from one unit to two once at the start of a session and stays
fixed afterwards, so it does not reserve empty space before the second unit
exists.

The native `VTTCue` fallback, used when a bare video element is fullscreen,
renders the same window as up to four lines plus the status line.

### Settings

Three fields are added to `AppSettings`, normalized and clamped in
`normalizeSettings` next to the existing font sizes:

| Field | Range | Default | Consumer |
| --- | --- | --- | --- |
| `maxLineWidth` | 40–140 | 90 | `CaptionChunker` (background) |
| `backgroundOpacity` | 0–100 | 78 | overlay CSS |
| `bottomOffset` | 0–60 | 8 | overlay CSS |

`backgroundOpacity` defaults to 78 to match the current
`rgba(3, 7, 18, 0.78)` background. `bottomOffset` is a percentage of video
height and defaults to 8 to clear the YouTube control bar.

The popup gains three `RangeField` sliders, which need `min`, `max`, and unit
props added to the existing component. Sliders stay enabled during a session.

Appearance is applied live through storage rather than new messages. The
content script reads the settings when the overlay is shown and subscribes to
`chrome.storage.onChanged`. `CaptionOverlay` stays pure: it receives a
`CaptionAppearance` object and never touches `chrome.storage`.

`CaptionAppearance` carries all four presentation fields —
`originalFontSize`, `translationFontSize`, `backgroundOpacity`, and
`bottomOffset` — which map onto the CSS variables `--caption-original-size`,
`--caption-translation-size`, `--caption-bg-opacity`, and
`--caption-bottom-offset`. The unit height used by the animation derives from
the two font-size variables, so it stays correct when the user changes them
mid-session. `OVERLAY_SHOW` therefore carries no payload; it replaces the
current `{ originalFontSize, translationFontSize }` payload, and `setSizes` is
replaced by `setAppearance`.

The background subscribes to the same storage changes so `maxLineWidth` takes
effect on the next unit of a running session.

## Error handling

Session error messages and the `translation_disabled` state keep their current
behavior. The status line remains below the window and is unaffected by the
push animation. A unit whose translation never arrives keeps an empty
translation line; the original line still shows and still scrolls up normally.

## Testing

- `CaptionChunker`: sentence-final and clause splitting, over-wide pieces with
  and without spaces, CJK double-width accounting, closed units staying frozen
  when a later revision contradicts them, and the open unit's displayed text
  being the raw remainder.
- `CaptionWindow`: dropping the oldest unit on a third insert, ignoring a
  translation for a dropped unit, and preserving arrival order.
- `CaptionOverlay`: DOM structure for one and two units, the push sequence's
  transform and class transitions, removal of the oldest unit on
  `transitionend`, appearance variables from an appearance object, and the
  native cue text.
- `CaptureSessionController`: chunk-keyed translation requests, `CAPTION_WINDOW`
  payloads, and window replay on content-script readiness.
- `normalizeSettings`: clamping the three new fields.
- Popup: the three sliders round-tripping through saved settings.

Existing controller and overlay tests that assert `CAPTION_ORIGINAL` or
`CAPTION_TRANSLATION` are rewritten against `CAPTION_WINDOW`.
