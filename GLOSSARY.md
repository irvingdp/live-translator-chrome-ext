# Live Translator

A Chrome extension that turns the audio of the current tab into bilingual captions (original and translation) shown over the page.

## Language

### Caption modes

**Live mode** (即時模式):
Captions translated from the audio the viewer is hearing right now, so they always trail the speech. Both Deepgram + DeepL and Gemini Live work this way.
_Avoid_: Realtime mode, normal mode

**Read-ahead mode** (預讀模式):
A separate caption mode that translates real upcoming audio before the viewer reaches it, so each caption appears as its speech starts. It never predicts what will be said.
_Avoid_: Prediction, prefetch, look-ahead translation

### Read-ahead

**Main player** (主播放器):
The media element the viewer is actually watching and hearing.
_Avoid_: Original video, foreground player

**Buffer tap** (緩衝擷取):
Reading upcoming audio straight from what the main player has already downloaded but not yet played. Used where the main player streams its media in pieces (YouTube).
_Avoid_: Interceptor, sniffer, prefetch

**Shadow player** (影子播放器):
A hidden, muted second copy of the same media that plays ahead of the main player and supplies the audio for read-ahead. Used for plain video files, where there is no buffer to tap.
_Avoid_: Ghost player, background player, preloader

**Chunk** (片段):
A stretch of upcoming audio sent for translation in one request, normally cut at a pause in speech.
_Avoid_: Segment, batch, window

**Lead** (提前量):
How far, in media time, upcoming audio has been read ahead of the main player. It grows up to 30 seconds.
_Avoid_: Offset, buffer, delay

**Hold** (讀取等待):
The main player paused by the extension, showing "讀取音訊中…", because it reached media time with no translation yet. It is distinct from a pause by the viewer.
_Avoid_: Buffering, warm-up, stall

**Cue** (定時字幕):
A read-ahead caption pinned to the media time its speech starts. It appears when the main player reaches that time.
_Avoid_: Timed caption, subtitle entry
