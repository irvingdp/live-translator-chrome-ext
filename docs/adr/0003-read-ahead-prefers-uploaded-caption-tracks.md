---
status: accepted
---

# Read-ahead prefers the uploader's caption tracks

Read-ahead turns upcoming audio into **cues** through a **recognizer** and a **translator** (ADR 0002). Many videos already ship timed captions written by their uploader. Those are better sentences than any recognizer's, and they cost no quota and need no audio.

So in read-ahead mode, when the video has a **caption track** in the spoken language, read-ahead reads the sentences from it and skips the recognizer. When it also has one in the target language, the translation comes from that track and the translator is skipped too. Without a caption track, everything works as before. This happens on its own; there is no setting.

- **Which track is the original:** the one in the popup's source language, or, when that is set to detect, the one in the language YouTube marks as the video's. With neither, there is no original track.
- **A target-language track only counts alongside an original one.** With a target track alone, the recognizer and translator run as before: recognized sentences and the uploader's lines are cut differently, so they could not be paired.
- **With an original track but no target track,** the translator translates (Chrome's built-in Translator, then Google's web translation), whatever the recognizer setting. Gemini's quota is not used.
- **Sentences:** consecutive cues are joined up to a sentence ender, and cut at 15 s without one. The translation of a sentence is the target cues that overlap it most, in order, each used once.
- **Timing:** the decision is made once per video, including YouTube's in-page navigation. Read-ahead waits for the track at most 2 s, holding the player with "讀取字幕中…", and otherwise uses the recognizer for the rest of that video. With a track no audio is read, so a seek lands on captions straight away. Translation still runs at most 30 s ahead, a batch at a time.

## How the YouTube track is read

YouTube's caption URLs now generally need a proof-of-origin token (`pot`) that the player computes. Fetching those URLs ourselves, or producing that token, would get around YouTube's restrictions, which this extension does not do. Instead:

1. The extension turns captions on through the YouTube player's own API.
2. It reads the response the player itself downloads, in the page, the way the buffer tap reads audio.
3. It hides YouTube's own caption rendering with CSS, so the two do not overlap.

The track is kept for the rest of the video once downloaded, whatever the viewer then does with the CC button. Stopping the captions restores the CC state from before and unhides YouTube's captions.

For ordinary HTML5 video, `<track>` elements are read through `video.textTracks`. A track the page cannot read (another origin without CORS) is treated as absent.

## Considered Options

- **YouTube's auto-generated captions as an original track:** rejected. They are mostly unpunctuated, so sentences could only be cut at pauses and translate poorly. Gemini and Whisper punctuate, so such videos go to the recognizer.
- **YouTube's auto-translate (`tlang`) as the translation:** rejected by the user. Only a track the uploader wrote in the target language replaces the translator.
- **Gemini translating the track's text** when Gemini is the recognizer: rejected. It would still spend the 500-a-day quota that ADR 0002 works around; the on-device translator costs nothing.
- **A setting to turn caption tracks off:** not now. It can be added to the popup if someone needs it.
- **Fetching `timedtext` URLs directly:** rejected; see above.

## Consequences

- The plan rests on one unverified fact: that after turning captions on through the player API, the player downloads the whole track in one response that the page can read. This is checked first, in real Chrome. If it does not hold, how the track is obtained is decided again.
- Live mode is unchanged: it translates what is heard now and has no use for timed captions ahead.
