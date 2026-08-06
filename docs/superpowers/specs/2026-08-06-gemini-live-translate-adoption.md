# Gemini Live Translate 3.5 as a Combined Provider — Adopted

**Decision: adopted**, as a second selectable provider alongside
Deepgram + DeepL. This does **not** reverse
`2026-08-06-gemini-translation-evaluation.md`, which rejected Gemini as a *text
translation* provider. That rejection stands. This is the audio path that
document listed as "the architecturally interesting one" and left open.

## Why the earlier objections do not apply here

The evaluation rejected Gemini on three grounds. Each is answered by using
`gemini-3.5-live-translate-preview` over a persistent WebSocket rather than
Gemini as a text translator:

### 1. Request rate

The measured 60–330 translation requests per minute came from
`TranscriptStabilizer` advancing one word (or one CJK character) at a time and
handing the growing row to a request-metered endpoint. Live Translate is one
long-lived session metered by **tokens per minute**, not requests. The
stabilizer and the chunker are not in this path at all — nothing re-sends a
growing prefix, because nothing sends anything but audio.

### 2. No free model does text in, text out

Correct, and irrelevant: this path is audio in, audio + transcripts out. The
table's own row for `gemini-3.5-live-translate-preview` (audio only, audio +
transcript) is exactly the shape used.

### 3. The blocking question — is the source transcript available?

**Yes.** The evaluation's first verification item ("Does it return a
source-language transcript? This is the question that decides everything else")
is answered by `setup.inputAudioTranscription: {}`, which makes the server send
`serverContent.inputTranscription.text` — an ASR of the tab audio in its own
language. The translated line arrives separately as
`serverContent.outputTranscription.text`, the transcription of the model's own
translated speech. Two distinct fields; no prompt parsing, no system
instruction. Verified against the working POC at
`~/projects/gemini-live-translate-chrome-extension-poc-v0.1.1` and against
<https://ai.google.dev/gemini-api/docs/live-api/live-translate>.

The free-tier terms objection is unchanged and unaddressed — it applies to any
free Gemini key. It is now the user's decision, made by choosing the provider,
rather than the extension's only option.

## What the shape of the integration follows from

- **Caption granularity.** The provider emits a whole utterance's original and
  translation as a pair. Running that original through `CaptionChunker` would
  cut it into display units with no way to cut the translation to match, so
  Gemini mode maps one model turn to one `CaptionWindow` row and bypasses
  `TranscriptStabilizer`, `CaptionChunker`, and `TranslationCoordinator`
  entirely. Everything from `CaptionWindow` outward — rolling rows, in-place
  row updates, the push animation, appearance settings, fullscreen tracking —
  is shared with the Deepgram path unchanged. The two `每行長度` sliders have
  nothing to act on and are hidden in this mode.
- **A row has to be capped, and capping it visually is what keeps the two
  languages aligned.** Server-side VAD only ends a turn on a real pause, so
  during continuous speech one turn — one row — runs for minutes and grows
  until it covers the video. Cutting the turn into rows on a width budget was
  rejected: the translation trails the source by 1–3 seconds, so every row's
  translation would sit about a third of a line behind the original above it,
  and the two lines lining up is the whole point of a bilingual caption.
  Instead the text is left alone and the box is capped in CSS
  (`.viewport.clamped`), showing the tail of each half. **The cap is applied to
  `.original` and `.translation` separately, not to the pair.** Capping only
  the pair keeps its bottom, which is entirely translation, and the source line
  vanishes — measured in Chromium before the per-half rule was added.
- **Retained turn text is capped too**, at 2000 characters per stream. The whole
  row is re-sent to the tab on every update, so an unbounded turn becomes an
  ever-larger `CAPTION_WINDOW` several times a second. `TurnStream` tracks how
  many characters it has dropped so the cumulative-vs-incremental prefix test
  still works against a tail.
- **Source language.** `translationConfig` has `targetLanguageCode` and no
  source field; detection is the model's. The picker renders the supported list
  but is disabled and reads 自動偵測, rather than storing a preference that
  never reaches the API.
- **Language codes.** BCP-47, and unrelated to the Deepgram/DeepL codes, so
  `GEMINI_LANGUAGE_OPTIONS` is a separate list and `geminiTargetLanguage` a
  separate setting. Switching providers therefore cannot leave an invalid code
  pointed at the other one.
- **Session lifetime.** The connection caps at ~10 minutes and the audio session
  at ~15, which a two-hour video crosses a dozen times. `GeminiLiveSession`
  declares `sessionResumption`, stores each `sessionResumptionUpdate.newHandle`,
  reconnects with it on `goAway` or an unexpected close, and buffers ~3 s of
  audio across the gap. Without this the feature would simply stop mid-video.
- **Response audio is discarded.** `responseModalities: ['AUDIO']` is the
  model's only option; the spoken translation in
  `serverContent.modelTurn.parts[].inlineData` is dropped. The tab's own audio
  stays audible through the existing unity-gain monitor in
  `browser-tab-audio-pipeline.ts`.

## Frames arrive as Blobs, not strings

Chrome delivers this endpoint's WebSocket frames as **binary**, so `event.data`
is a `Blob` even though the payload is UTF-8 JSON. Google's own hand-written
WebSocket example — and the POC — do `JSON.parse(event.data)` directly, which
throws on a Blob; the POC swallows it in a `catch` and therefore sees an empty
conversation, including no `setupComplete`. The Node examples appear to work
only because `ws` yields a Buffer, which `JSON.parse` coerces to a string.

`readSocketFrame` handles string, Blob, `ArrayBuffer`, and any `ArrayBufferView`,
duck-typed rather than by `instanceof` because a frame can cross realms. Because
Blob decoding is asynchronous, frames are applied through a promise chain: two
transcript fragments that arrive in order must be applied in order, or a row
silently reverts to an earlier prefix.

## Two bugs in the POC that were not carried over

1. It reset the reconnect attempt counter on the socket's `open` event. A socket
   that opens and is *then* closed — which is what a session expiry or a
   post-setup auth rejection looks like — would therefore never exhaust its
   retries and would reconnect forever at 500 ms. Here the counter resets only
   on `setupComplete`.
2. It never cleared `lastError`, letting a stale message misclassify a later,
   unrelated close as fatal. Here it is cleared per attempt.

## Diagnosing a session that produces no captions

`GeminiLiveSession` logs its lifecycle to the offscreen document's console
(chrome://extensions → 檢查檢視畫面 → offscreen.html). The expected sequence is
`opening socket` → `setup accepted` → `first audio chunk sent` → `first
transcription received`. Where it stops says which layer failed, and
`socket closed` carries the server's own code and reason.

If setup is accepted and audio flows but no transcription ever arrives, the
next thing to try is moving `inputAudioTranscription` / `outputAudioTranscription`
inside `generationConfig`. The two Google sources disagree: the WebSocket
reference at <https://ai.google.dev/api/live> lists them as top-level fields of
`BidiGenerateContentSetup` (which is what the SDKs emit, and what this code
does), while the hand-written WebSocket snippet on the live-translate page nests
them in `generationConfig`.

## Open question to verify against the live API

`GeminiCaptionAccumulator` merges transcript fragments with
`next.startsWith(accumulated) ? next : accumulated + next`, which is correct
whether the model sends cumulative text (as the POC assumes) or incremental
fragments (as other Live models do). If the model turns out to *revise* earlier
words within a turn, that one function is the only thing that needs changing.

## Sources

- <https://ai.google.dev/gemini-api/docs/live-api/live-translate> (78 supported
  languages, audio format, `translationConfig`)
- <https://ai.google.dev/gemini-api/docs/live-session> (session limits,
  resumption, `goAway`)
- `~/projects/gemini-live-translate-chrome-extension-poc-v0.1.1` — working
  reference for the endpoint, setup message, and audio framing
