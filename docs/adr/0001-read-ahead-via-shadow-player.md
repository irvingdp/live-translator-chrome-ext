---
status: accepted
---

# Read-ahead mode: buffer tap or shadow player + chunked generateContent

Live captions always trail the speech, because `chrome.tabCapture` only hears what is playing now. **Read-ahead mode** is a separate caption mode with its own switch, alongside the existing live modes, which stay unchanged. It gets upcoming audio in one of two ways.

- **Buffer tap.** Used on YouTube. The main player streams through Media Source Extensions and already downloads 30–50 s ahead of playback. A MAIN-world content script installed at `document_start` wraps `MediaSource.prototype.addSourceBuffer`. From each audio SourceBuffer's `appendBuffer` data it demuxes the WebM stream into Opus frames, each carrying its media timestamp (Cluster timecode plus block offset). The frames are decoded with WebCodecs `AudioDecoder`.
- **Shadow player.** Used on plain HTML5 video. A hidden, muted second `<video>` with the same `src` plays ahead of the main player, and its audio is taken with `captureStream()`.

The audio is cut into **chunks** at pauses in speech and sent to the non-Live `generateContent` API (`gemini-flash-lite-latest`). A JSON schema asks for `{start, end, original, translation, cut}` per sentence. Each **cue** is pinned to chunk start + `start`. The main player may not play into media time that has no translation yet. Instead it **holds**: it pauses, shows "讀取音訊中…", and resumes on its own.

## Considered Options

- **Gemini Live (`gemini-3.5-live-translate-preview`) fed ahead-of-time audio**: rejected. A 2026-11-15 spike showed it never fills `startOffset`/`endOffset`, and `wordTimestamp` is refused ("not supported in BidiGenerateContent"), so cue times could only be guessed from arrival time.
- **Delayed presentation** (capture the tab's audio and video and show the viewer a delayed copy): rejected. DRM sites capture as black frames, and replacing the page's player hurts quality and A/V sync.
- **Live captions during warm-up**: rejected in favour of a hold. They trailed the speech and split sentences at the handoff.
- **Fixed-length chunks**: rejected in favour of cutting at pauses. A chunk is cut at the longest pause (≥0.3 s of silence) that falls between 10 and 15 s. If there is no pause by 15 s, it is hard-cut with 2 s of overlap. The first chunk after a start or seek is cut at the first pause past 2 s, so the first hold lasts only about one sentence.
- **Cutting at every 0.3 s pause**: rejected. On a real talk it produced 1.7–5 s chunks, 22 requests a minute. The free-tier key hit 429 after about 18 requests, and sentences with a mid-sentence pause were translated in fragments.
- **YouTube shadow player as a hidden `youtube.com/embed/<id>` iframe**: rejected. Inside a youtube.com page the embed fails with error 152-4. Hosted by an extension page, directly or nested in youtube.com, it fails with error 153, because extension pages send no Referer. Spoofing the Referer would circumvent YouTube's embed policy.
- **YouTube shadow player as a background tab (`active: false`)**: rejected. Chrome defers media in a tab that has never been shown, so the video never loads. Showing the tab briefly and then backgrounding it does work, but it flashes the tab and adds one to the tab strip.
- **YouTube shadow player in a minimized window**: it works (macOS), but was rejected by the product owner. An extra window is not acceptable.
- **Fetching YouTube's audio stream separately** (as yt-dlp does): rejected. It needs YouTube's signature and token handling, which is circumvention, and it breaks often.

## Consequences

- Read-ahead is a third entry in the popup's provider dropdown, next to Gemini live and Deepgram. It shares the Gemini API key, and the live code paths are not touched.
- The model is fixed to `gemini-flash-lite-latest` and is not user-selectable, because a slow model (e.g. `gemini-3.8-flash` at 245 s per chunk) would hold the player indefinitely.
- Read-ahead works on YouTube (buffer tap, WebM/Opus audio) and on plain HTML5 video (shadow player). Other MSE sites and other audio formats (fMP4/AAC from hls.js, dash.js) are not supported in v1. On DRM sites, choosing read-ahead shows a notice suggesting Gemini live, and the extension never switches modes on its own.
- The buffer tap reads only data YouTube has already downloaded for playback in the viewer's own browser. Nothing is downloaded twice and no window or tab is opened. In exchange, the lead is bounded by YouTube's own buffer (30–50 s observed), and the tap depends on YouTube's player internals (MSE, WebM Clusters), which can change without notice.
- YouTube appends do not line up with Clusters: about 10 s Clusters arrive split across many appends. The demuxer must therefore be a streaming parser that resets when an append starts with an EBML header or a Cluster (seek), or on `SourceBuffer.abort()`.
- YouTube ads play through their own MediaSource, with timestamps starting at 0 that overlap the video's. Audio appended while `#movie_player` has `ad-showing`, and every SourceBuffer of that MediaSource, is excluded.
- After a seek YouTube buffers from the new position, so the sentence that straddles the seek point may only be partly available. It is dropped (`cut`), and captions resume at the next sentence.
- Translation stops 30 s ahead of the main player even if more is buffered. Holds are distinct from viewer pauses: a viewer pause during a hold is never auto-resumed.
- A chunk that fails after two retries leaves that stretch uncaptioned with a "翻譯失敗" note. The main player is not held for it.
- Translated cues are kept in memory for the current viewing, so rewinding reuses them. Changing the video, closing the tab or changing the target language clears them.
- Costs we accept: translation of read-ahead the viewer never watches, and read-ahead discarded on forward seeks. On plain HTML5 video the media is also downloaded twice.
- The side panel lists only cues the main player has reached.
- Timestamp accuracy is 0.0–0.3 s between sentence starts and the human-timed captions of a real TED talk. This held both for audio taken from the buffer tap (also after a seek) and for audio from `captureStream()`. Soundtracks with music or overlapping speakers are still unmeasured.
- Testing: YouTube blocks seeking in Playwright-controlled browsers, and Playwright reports every page as `visible`. Integration checks for the buffer tap must run in a browser started directly with the extension loaded.
