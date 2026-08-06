# Privacy Policy — Bilingual Live Captions

**Last updated: 2026-08-07**

## Summary

This extension has no server and the developer receives none of your data. What it
does: it sends the audio of a tab you pick to a speech/translation service you
choose, using **your own API key**, and draws the returned text on screen.

## Data collected by the developer

**None.** There is no analytics, no telemetry, and no backend. Nothing is ever sent
to the developer. The developer cannot tell that you installed it, what you watched,
or what was said.

## Data that leaves your device

Once you start captions, **the audio of the tab you selected** is sent to the
provider you chose. The connection goes from your browser straight to that service,
with no intermediary server:

| Provider you choose | What is sent | Where it goes |
| --- | --- | --- |
| Gemini live translate 3.5 (default) | Tab audio | Google (`generativelanguage.googleapis.com`) |
| Deepgram Nova-3 + DeepL | Tab audio to Deepgram; the recognised text to DeepL | Deepgram (`api.deepgram.com`), DeepL (`api.deepl.com` or `api-free.deepl.com`) |

Audio is captured only after you press start, and only for the one tab you selected.
Capture stops when you press stop or close that tab. The original and translated
text is only rendered on screen; it is never written to a file or a log.

## Data that stays on your device

- **API keys**: stored in `chrome.storage.local`, on this machine and this Chrome
  profile only. Chrome Sync is not used. They never leave the device except as
  authentication to the one service each key belongs to.
- **Caption appearance and language settings**: also in `chrome.storage.local`.
- **Session state**: held in `chrome.storage.session` (cleared when Chrome closes)
  and **contains no API keys** — they are stripped before it is written.

You can clear the key fields on the options page and save at any time. Removing the
extension deletes all of the above local data.

## Third-party services

How your audio and text are used is governed by the provider you choose and your
agreement with them, not by this extension. Please read:

- Google Gemini API — [terms](https://ai.google.dev/gemini-api/terms),
  [Google Privacy Policy](https://policies.google.com/privacy)
- Deepgram — [privacy policy](https://deepgram.com/privacy)
- DeepL — [privacy policy](https://www.deepl.com/privacy)

## Two things to know before using a free Gemini key

Gemini is the default provider, and Google's free-tier terms differ from the paid
tier:

1. **Free-tier input is used by Google to improve its products and may be read by
   human reviewers.** Audio captured with a free key should therefore not contain
   confidential, sensitive, or personal information. For such content, use a paid
   key or switch to Deepgram + DeepL.
2. **The free tier is not available in the EEA, the UK, or Switzerland.** Users
   there need a paid-tier key.

## Why each permission is needed

| Permission | Purpose |
| --- | --- |
| `tabCapture` | Capture the audio of the tab you selected — the only source of caption text |
| `offscreen` | A Manifest V3 service worker cannot use AudioContext, so audio processing and the provider connection run in an offscreen document |
| `activeTab`, `scripting` | Inject the caption overlay into the tab where you pressed start |
| `storage` | Save your API keys and caption settings |
| `https://*/*` content script | Captions must be able to sit on top of any video site. The script only draws captions; it never reads or transmits page content |
| `host_permissions` | Limited to the four provider API domains used for the connections above |

## Children

This extension is not directed at children under 13 and does not knowingly collect
their data — it collects no one's data.

## Changes

If this policy changes, the date at the top of this page is updated and the change
ships with a new version.

## Contact

Please open an issue at
<https://github.com/irvingdp/live-translator-chrome-ext/issues>.
