---
status: accepted
---

# Read-ahead mode: shadow player + chunked generateContent

Live captions always trail the speech, because `chrome.tabCapture` only hears what is playing now. **Read-ahead mode** is a separate caption mode with its own switch, alongside the existing live modes, which stay unchanged. A hidden, muted **shadow player** plays a second copy of the same media ahead of the main player. Its audio (via `captureStream()`) is cut into **chunks** at pauses in speech and sent to the non-Live `generateContent` API (`gemini-flash-lite-latest`) with a JSON schema asking for `{start, end, original, translation, cut}` per sentence. Each **cue** is pinned to chunk start + `start`. The main player may not play into media time that has no translation yet: it **holds**, showing "讀取音訊中…", and resumes on its own.

## Considered Options

- **Gemini Live (`gemini-3.5-live-translate-preview`) fed by the shadow player**: rejected. A 2026-11-15 spike showed it never fills `startOffset`/`endOffset`, and `wordTimestamp` is refused ("not supported in BidiGenerateContent"), so cue times could only be guessed from arrival time. The same spike measured chunked `generateContent` at ±0.3 s sentence starts, with 2–3 s per 15–35 s chunk.
- **Delayed presentation** (capture the tab's audio and video and show the viewer a delayed copy): rejected. DRM sites capture as black frames, and replacing the page's player hurts quality and A/V sync.
- **Live captions during warm-up**: rejected in favour of a hold. They trailed the speech and split sentences at the handoff.
- **Fixed-length chunks**: rejected in favour of cutting at pauses. A chunk is cut at the longest pause (≥0.3 s of silence) that falls between 10 and 15 s; with no pause by 15 s it is hard-cut with 2 s of overlap. The first chunk after a start or seek is cut at the first pause past 2 s, so the first hold lasts only about one sentence.
- **Cutting at every 0.3 s pause**: rejected. On a real talk (2026-11-15 spike) it produced 1.7–5 s chunks, 22 requests a minute. The free-tier key hit 429 after about 18 requests, and sentences with a mid-sentence pause were translated in fragments.
- **YouTube shadow player as a hidden `youtube.com/embed/<id>` iframe**: rejected. Inside a youtube.com page the embed fails with error 152-4. Hosted by an extension page (directly or nested in youtube.com) it fails with error 153, because extension pages send no Referer. Spoofing the Referer would circumvent YouTube's embed policy.
- **YouTube shadow player as a background tab (`active: false`)**: rejected. Chrome defers media in a tab that has never been shown, so the video never loads. Showing the tab for a moment and then backgrounding it works, but it flashes the tab and adds one to the tab strip.

## Consequences

- Read-ahead is a third entry in the popup's provider dropdown, next to Gemini live and Deepgram. It shares the Gemini API key. The live code paths are not touched.
- The model is fixed to `gemini-flash-lite-latest` and not user-selectable, because a slow model (e.g. `gemini-3.8-flash` at 245 s per chunk) would hold the player indefinitely.
- On DRM sites, choosing read-ahead shows a notice suggesting Gemini live. It never switches modes on its own.
- Only plain HTML5 video (a second `<video>` with the same `src`) and YouTube can read ahead. DRM sites keep using live mode.
- On YouTube the shadow player is the same watch page in a window the extension opens minimized (MSE `blob:` sources cannot be cloned). The tab is muted with `chrome.tabs.update({ muted: true })`, and a content script captures its audio. On macOS a minimized window stays `visible` and plays, captures, seeks and changes rate normally. Windows and Linux are untested. The shadow watch page also plays its own ads, adds to the viewer's watch history, and must be kept from autoplaying the next video.
- The lead grows through holds up to 30 seconds. Holds are distinct from viewer pauses: a viewer pause during a hold is never auto-resumed.
- A chunk that fails after two retries leaves that stretch uncaptioned with a "翻譯失敗" note. The main player is not held for it.
- Translated cues are kept in memory for the current viewing, so rewinding reuses them. Changing the video, closing the tab or changing the target language clears them.
- Costs we accept: media downloaded twice, translation of read-ahead the viewer never watches, and read-ahead discarded on forward seeks.
- The side panel lists only cues the main player has reached.
- Timestamp accuracy: sentence starts are within 0.0–0.3 s of human-timed captions on 60 s of a real TED talk, and within ±0.32 s on synthetic speech. Soundtracks with music or overlapping speakers are still unmeasured.
