---
status: accepted
---

# Read-ahead prefers the uploader's caption tracks

Read-ahead turns upcoming audio into **cues** through a **recognizer** and a **translator** (ADR 0002). Many videos already ship timed captions written by their uploader. Those are better sentences than any recognizer's, and they cost no quota and need no audio.

So in read-ahead mode, when the video has a **caption track** in the spoken language, read-ahead reads the sentences from it and skips the recognizer. When it also has one in the target language, the translation comes from that track and the translator is skipped too. Without a caption track, everything works as before. This happens on its own. Since issue #18, the viewer can turn it off ("優先使用影片字幕軌"); see Considered Options.

- **Which track is the original:** the one in the popup's source language, or, when that is set to detect, the one in the spoken language. YouTube has no field for that, but its own speech-recognition track is in it; a plain video's `default` track stands in. With neither, there is no original track.
- **A target-language track only counts alongside an original one.** With a target track alone, the recognizer and translator run as before: recognized sentences and the uploader's lines are cut differently, so they could not be paired.
- **With an original track but no target track,** the translator translates (Chrome's built-in Translator, then Google's web translation), whatever the recognizer setting. Gemini's quota is not used.
- **Sentences:** consecutive cues are joined up to a sentence ender, and cut at 15 s or a silence over 2 s without one. The translation of a sentence is the target cues that overlap it most, in order, each used once.
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
- **A setting to turn caption tracks off:** not at first. It was added with word highlight (issue #18): a caption track has no word timing, so a viewer who wants words marked must be able to choose Whisper instead. The popup has "優先使用影片字幕軌" (on by default). With word highlight on, the notice reads "使用 YouTube 字幕（不支援逐字標示）" and carries a "改用語音辨識" button, which turns the setting off and restarts on the recognizer from where the viewer is.
- **Fetching `timedtext` URLs directly:** rejected; see above.

## Consequences

- Verified in real Chrome on 2026-11-17 (TED "Grit", 373 s): fetching a track's listed URL ourselves returns an empty body. After `setOption('captions', 'track', …)` the player downloads the whole track (`fmt=json3`, with its token) in one XMLHttpRequest, which a MAIN-world hook reads, in about 20 ms. Choosing the track already showing downloads nothing, so that one is reloaded (`setOption('captions', 'reload', true)`). `setOption('captions', 'track', {})` turns captions off, which is how "off" is put back.
- The viewer's track is put back right after the download, not at stop: YouTube's caption rendering stays hidden while the captions run, so the switch is never seen.
- A streamed plain video (`blob:` source), which read-ahead could not read audio from, now works when it has a readable caption track.
- With Gemini as the recognizer, a track that needs translating uses Chrome's translator and Google's web translation. Google's host is only granted with a Whisper recognizer, so without it a pair Chrome cannot translate fails as "翻譯失敗". The popup starts Chrome's language-pack download on every read-ahead start for this.
- Live mode is unchanged: it translates what is heard now and has no use for timed captions ahead.
