---
status: accepted
---

# Read-ahead mode: shadow player + chunked generateContent

Live captions always trail the speech, because `chrome.tabCapture` only hears what is playing now. **Read-ahead mode** is a separate caption mode with its own switch, alongside the existing live modes, which stay unchanged. A hidden, muted **shadow player** plays a second copy of the same media ahead of the main player. Its audio (via `captureStream()`) is cut into **chunks** at pauses in speech and sent to the non-Live `generateContent` API (`gemini-flash-lite-latest`) with a JSON schema asking for `{start, end, original, translation, cut}` per sentence. Each **cue** is pinned to chunk start + `start`. The main player may not play into media time that has no translation yet: it **holds**, showing "讀取音訊中…", and resumes on its own.

## Considered Options

- **Gemini Live (`gemini-3.5-live-translate-preview`) fed by the shadow player**: rejected. A 2026-11-15 spike showed it never fills `startOffset`/`endOffset`, and `wordTimestamp` is refused ("not supported in BidiGenerateContent"), so cue times could only be guessed from arrival time. The same spike measured chunked `generateContent` at ±0.3 s sentence starts, with 2–3 s per 15–35 s chunk.
- **Delayed presentation** (capture the tab's audio and video and show the viewer a delayed copy): rejected. DRM sites capture as black frames, and replacing the page's player hurts quality and A/V sync.
- **Live captions during warm-up**: rejected in favour of a hold. They trailed the speech and split sentences at the handoff.
- **Fixed-length chunks**: rejected in favour of cutting at pauses (≥0.3 s silence, 15 s max with 2 s overlap). Cutting at pauses keeps sentences whole, and the first hold lasts only about one sentence.

## Consequences

- Read-ahead is a third entry in the popup's provider dropdown, next to Gemini live and Deepgram. It shares the Gemini API key. The live code paths are not touched.
- The model is fixed to `gemini-flash-lite-latest` and not user-selectable, because a slow model (e.g. `gemini-3.8-flash` at 245 s per chunk) would hold the player indefinitely.
- On DRM sites, choosing read-ahead shows a notice suggesting Gemini live. It never switches modes on its own.
- Only plain HTML5 video (a second `<video>` with the same `src`) and YouTube (a hidden `youtube.com/embed/<id>` iframe, because MSE `blob:` sources cannot be cloned) can read ahead. DRM sites keep using live mode.
- The lead grows through holds up to 30 seconds. Holds are distinct from viewer pauses: a viewer pause during a hold is never auto-resumed.
- A chunk that fails after two retries leaves that stretch uncaptioned with a "翻譯失敗" note. The main player is not held for it.
- Translated cues are kept in memory for the current viewing, so rewinding reuses them. Changing the video, closing the tab or changing the target language clears them.
- Costs we accept: media downloaded twice, translation of read-ahead the viewer never watches, and read-ahead discarded on forward seeks.
- The side panel lists only cues the main player has reached.
- Timestamp accuracy was measured on clean synthetic speech only. Real soundtracks (music, overlapping speakers) still need checking.
