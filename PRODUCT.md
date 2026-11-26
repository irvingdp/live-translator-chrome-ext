# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who watch foreign-language video in Chrome (YouTube talks and interviews, Korean variety shows, Bilibili) and want to follow it with the original line and its translation side by side. Most read Traditional Chinese; the English interface must be just as complete. They are willing to bring their own API key.

## Product Purpose

雙語即時字幕翻譯 (Bilingual Live Captions) is a Chrome extension that puts a two-line caption over the video being watched: the original speech on top, its translation underneath. Success is a viewer who watches the video, not the captions: the captions are there, in time and readable, and the video stays the main thing on screen.

## Positioning

- **Read-ahead: captions are not half a beat late.** Read-ahead mode translates audio the player has already loaded, so each caption appears as the speaker starts the sentence. The video holds briefly when the next sentence is not ready, instead of letting captions trail the speech.
- **The viewer's own keys, no server of ours.** No subscription, no account and no analytics. Audio and text go straight from the browser to the service the viewer chose. Local Whisper keeps the audio on the computer.
- **Translation quality.** Groq (Qwen) translates with the neighbouring sentences as context, so idioms read naturally and terms stay consistent.
- **Any video.** Live mode captures the tab's audio, so it works on any tab, whether or not the video has captions of its own.

## Operating Context

- **Two caption modes, chosen in the popup.** Live mode is Gemini Live and works on any tab. Read-ahead recognizes speech with Groq Whisper or Local Whisper. It translates with Groq (Qwen) or Chrome's built-in Translator, and uses the uploader's caption tracks when a video has them.
- **Where viewers meet the product:**
  - the popup: mode, services, keys, languages and appearance;
  - the floating caption box over the video: drag, resize, a toolbar with size and background bars, and a status light;
  - the side panel: caption history;
  - the options page: keys and allowed sites;
  - the onboarding page;
  - on YouTube and Bilibili, a player button in the site's own controls with a small menu.
- **Ordinary viewing.** The video is often fullscreen and often with other extensions installed, such as Dark Reader or other caption extensions.
- Vocabulary is defined in `GLOSSARY.md`; decisions are in `docs/adr/`.

## Capabilities and Constraints

- Chrome Manifest V3, Chrome 116+. Host access stays minimal and is checked by `scripts/verify-manifest.mjs`. Pages are never read for their content.
- Live mode can only start from the extension's own button (tab capture), or later in a tab where that button was used.
- Read-ahead supports YouTube and ordinary HTML5 video, plus streaming players on sites the viewer allows. It does not support live streams or DRM video.
- **Must not cover the video.** The caption box and menus appear only when needed, and the video always stays the main thing on screen.
- **Must coexist with other extensions.** It has to display correctly alongside Dark Reader and other caption extensions: its own UI lives in shadow DOM, and nothing may depend on colours a page-darkening extension can freeze.
- **Traditional Chinese first, English complete.** Every string ships in `zh_TW` and `en`.

## Brand Commitments

- Name: 雙語即時字幕翻譯 / Bilingual Live Captions. The extension icon is in `public/icon/`.

## Evidence on Hand

- Marketing site (Astro) in `site/`, published at https://irvingdp.github.io/live-translator-chrome-ext/.
- Promo video (Remotion) in `video/`.
- Store screenshots in `docs/store-assets/` (1.0.0, 1.2.0). They predate the current caption toolbar and the removal of Gemini from read-ahead.
- There are no testimonials, user counts or reviews on hand: do not fabricate them.

## Product Principles

1. The video comes first: captions serve the viewing and never compete with it.
2. Captions in time: when the choice is between a late caption and a brief hold, the caption is on time.
3. The viewer's keys, the viewer's data: nothing goes through us, and each permission is explained where it is asked for.
4. Say what is wrong and what to do: a failure names the service and offers the way out, such as switching the service, adding the key or allowing the site.
