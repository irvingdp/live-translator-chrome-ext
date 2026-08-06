# Gemini as a Translation Provider — Evaluation

**Decision: not adopted.** The "Gemini 3.5 Live（即將推出）" option has been
removed from the popup rather than left as a promise we are not keeping.

## What was asked

Use the Gemini Live API for translation, on the free tier, with an end-to-end
target of 0.5 s.

## Why not

### 1. Our request rate is an order of magnitude over the free tier

Measured from the pipeline, per minute of continuous speech:

| Source language | Translation requests / minute |
| --- | --- |
| English | 60–150 (≈100 typical) |
| CJK | 200–330 |

The driver is `TranscriptStabilizer`: `stableBoundary` trims to the last space,
so stable text advances **one word at a time**, and `CaptionChunker` hands the
open row's growing prefix to the controller on every advance. A single caption
row is therefore translated 10–15 times as it grows, at ~40 characters per
request — roughly **5× character amplification** over translating each row once.

For CJK the amplification is worse: with no whitespace in the common prefix,
`stableBoundary` returns the whole prefix, so stable text advances **per
character**.

`translatedSources` in `CaptureSessionController` removes the byte-identical
re-send when a row closes, but that is ≤1 request per row — about 7–10% of the
total, not a halving.

Google **no longer publishes free-tier RPM/TPM/RPD**. The rate-limits page now
says limits "can be viewed in Google AI Studio" behind a login. The last
published Flash-class figure was 10–15 RPM. Any number quoted elsewhere today is
stale; verify against your own project's dashboard before relying on it.

### 2. No free model does text in, text out

| Model | Input | Output | Free tier |
| --- | --- | --- | --- |
| `gemini-3.5-live-translate-preview` | **audio only** | audio + transcript | — |
| `gemini-2.5-flash-native-audio-preview-12-2025` | audio, video, text | **audio only** | unconfirmed |
| `gemini-3.1-flash-live-preview` | text, images, audio, video | text and audio | **requires billing** |

The only model that fits a text-in/text-out translator is the one Google says
needs a billed project — a staff reply on the official developer forum
(2026-08-05) states this, and free keys receive WebSocket close 1011
"You exceeded your current quota" at generation time, not connect time. The
model whose name suggests it is purpose-built for this, Live Translate, cannot
accept text at all.

### 3. Free-tier terms are wrong for caption content

Free-tier input is used to improve Google products, human reviewers may read it,
and the terms explicitly say not to submit sensitive, confidential, or personal
information. Captions carry whatever the user happens to be watching. Separately,
making the extension available to users in the EEA, UK, or Switzerland requires
Paid Services.

## The rate is self-inflicted, and that matters beyond Gemini

100 requests/minute is not the cost of real-time translation — it is the cost of
re-translating each row once per stabilized word. Translating only **completed**
rows would cut it to roughly **10–20 requests/minute**, inside even a
conservative free tier, at the price of the bottom row's translation appearing
4–6 seconds late instead of growing with the speech.

That trade is available to any provider, including DeepL if its 500k
characters/month ever becomes the binding constraint. It is a product decision
about how live the live row should feel, not a provider decision.

## If Gemini is revisited

`gemini-3.5-live-translate-preview` is the architecturally interesting one: a
persistent WebSocket session taking audio and emitting translation, **metered by
tokens per minute rather than requests per minute**, which sidesteps the rate
problem entirely and could replace Deepgram and DeepL together.

Verify these in order before designing anything:

1. **Does it return a source-language transcript?** The docs promise translated
   audio plus a text transcript but do not say whether the original is available.
   This extension is bilingual; without the source line, half the feature is gone.
   This is the question that decides everything else.
2. Free-tier availability, which is unconfirmed for every Live model.
3. Token burn: audio accumulates at ~25 tokens/second, so a session costs ~1500
   input tokens/minute continuously, unlike text translation which costs nothing
   while nobody is speaking.
4. Session lifecycle: audio-only sessions cap at 15 minutes, the connection
   itself at ~10 minutes, with a `GoAway` warning and resumption tokens valid for
   2 hours. A two-hour video means a dozen seamless reconnects while captions
   keep running.

## On the 0.5 s target

The current DeepL pipeline does not guarantee 0.5 s either. `README.md` calls it
a stretch target and sets the real gate at p50 ≤ 800 ms / p95 ≤ 1500 ms, and
**end-to-end latency has never been measured** — the Deepgram leg has not run in
this workspace for want of a key. If 0.5 s becomes a hard requirement, the first
step is measurement, not a change of provider. LLM generation latency is both
higher and more variable than a dedicated translation endpoint, which is an
argument for DeepL independent of quota.

## Sources

- <https://ai.google.dev/gemini-api/docs/rate-limits> (updated 2026-07-21)
- <https://ai.google.dev/gemini-api/docs/pricing>
- <https://ai.google.dev/gemini-api/docs/models>
- <https://ai.google.dev/gemini-api/docs/live-api> and `/live-api/capabilities`
- <https://ai.google.dev/gemini-api/docs/live-api/live-translate>
- <https://ai.google.dev/gemini-api/docs/live-session>
- <https://ai.google.dev/gemini-api/terms>
- <https://discuss.ai.google.dev/t/gemini-3-1-flash-live-preview-returns-quota-exceeded-on-every-new-api-key/177118> (Google staff, 2026-08-05)
- <https://discuss.ai.google.dev/t/official-concurrent-session-rps-limits-for-gemini-live-api-where-are-they-documented/174664> (Google staff, 2026-07-13)
