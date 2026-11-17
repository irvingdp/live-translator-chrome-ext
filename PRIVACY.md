# Privacy Policy — Bilingual Live Captions

**Last updated: 2026-11-17**

## Summary

This extension has no server, and the developer receives nothing from you unless
you choose to send feedback. What it does: it sends the audio of a video you pick to the speech and translation
services you choose, using **your own API keys**, and draws the returned text on screen.

## Data collected by the developer

**Nothing, unless you send feedback.** There is no analytics and no telemetry. The
developer cannot tell that you installed it, what you watched, or what was said.

After you have used captions on a couple of tabs, the popup may ask you for a star
rating, at most twice. **Clicking 4 or 5 stars sends that rating straight away**
(with the version, provider and language below, and nothing else). Clicking 1 to 3
stars shows a short form instead: an optional "what could be better?" choice
(inaccurate translation, captions lag, hard-to-use interface, or other), and a
comment box only if you choose "other"; that is sent **only when you press Send**.
In either case the extension transmits at most:

- your star rating, the choice you made and the comment you typed, if any,
- the extension version, the caption mode you use (Gemini live or read-ahead), and the
  extension's interface language.

It never includes your email address, tab URL, API keys, audio, or caption text,
and the form does not ask who you are. The form is
posted to a Google Apps Script owned by the developer, which stores it in a private
Google Sheet and forwards it to the developer's email. It is used only to improve
the extension and is never sold or shared. To have feedback deleted, contact the
developer (see below).

## Data that leaves your device

Once you start captions, **the audio of the video you selected** is sent to the
services you chose. The connections go from your browser straight to those
services, with no intermediary server:

| Caption mode and services | What is sent | Where it goes |
| --- | --- | --- |
| Gemini live translate 3.5 (default) | The tab's audio, as it plays | Google (`generativelanguage.googleapis.com`) |
| Read-ahead with Gemini | Audio the page's video player has already loaded, in 10–15 second pieces, a little ahead of what is playing | Google (`generativelanguage.googleapis.com`) |
| Read-ahead with Groq Whisper | The same audio pieces | Groq (`api.groq.com`) |
| Read-ahead with Cloudflare Whisper | The same audio pieces | Cloudflare Workers AI (`api.cloudflare.com`) |
| …translated by Chrome's built-in translation | The text Groq or Cloudflare recognized | Nowhere: Chrome translates it on your device |
| …where Chrome's built-in translation cannot translate | The text Groq or Cloudflare recognized | Google (`translate.googleapis.com`): the web translation behind Google's page translation, used without an account or key |

Audio is read only after you press start, and only for the one tab you selected.
It stops when you press stop or close that tab. The original and translated
text is only rendered on screen; it is never written to a file or a log.

## Data that stays on your device

- **API keys**: stored in `chrome.storage.local`, on this machine and this Chrome
  profile only. Chrome Sync is not used, and content scripts are explicitly
  denied access to this storage area. The keys never leave the device except as
  authentication to the one service each key belongs to.
- **Caption appearance and language settings**: also in `chrome.storage.local`.
- **Session state**: held in `chrome.storage.session` (cleared when Chrome closes)
  and **contains no API keys** — they are stripped before it is written.
- **Rating prompt state**: whether you have rated, and how many tabs you have used
  captions on (a counter plus recent tab ids), in `chrome.storage.local`. It only
  decides when to show the rating card and never leaves the device.

You can clear the key fields on the options page and save at any time. Removing the
extension deletes all of the above local data.

## Third-party services

How your audio and text are used is governed by the provider you choose and your
agreement with them, not by this extension. Please read:

- Google Gemini API — [terms](https://ai.google.dev/gemini-api/terms),
  [Google Privacy Policy](https://policies.google.com/privacy)
- Groq — [privacy policy](https://groq.com/privacy-policy/) (read-ahead with Groq Whisper)
- Cloudflare — [privacy policy](https://www.cloudflare.com/privacypolicy/) (read-ahead with Cloudflare Whisper)
- Google — [privacy policy](https://policies.google.com/privacy) (read-ahead's web translation fallback)

## Two things to know before using a free Gemini key

Gemini is the default for both caption modes, and Google's free-tier terms differ
from the paid tier:

1. **Free-tier input is used by Google to improve its products and may be read by
   human reviewers.** Audio captured with a free key should therefore not contain
   confidential, sensitive, or personal information. For such content, use a paid
   key.
2. **The free tier is not available in the EEA, the UK, or Switzerland.** Users
   there need a paid-tier key.

## Why each permission is needed

| Permission | Purpose |
| --- | --- |
| `tabCapture` | Capture the audio of the tab you selected — the only source of caption text |
| `offscreen` | A Manifest V3 service worker cannot use AudioContext, so audio processing and the provider connection run in an offscreen document |
| `activeTab`, `scripting` | Inject the caption overlay only into the tab where you pressed start; no script is registered across all websites |
| `storage` | Save your API keys, caption settings and whether you have rated the extension |
| `host_permissions` | Limited to Google's Gemini API domain used above |
| `optional_host_permissions` | `api.groq.com` and `api.cloudflare.com`, each asked for only when you choose Groq Whisper or Cloudflare Whisper, together with the web translation fallback's host (`translate.googleapis.com`) |

## Children

This extension is not directed at children under 13 and does not knowingly collect
their data. The optional feedback form asks for nothing beyond what you choose to type.

## Changes

If this policy changes, the date at the top of this page is updated and the change
ships with a new version.

## Contact

Please open an issue at
<https://github.com/irvingdp/live-translator-chrome-ext/issues>, or email
irvingdp@gmail.com (for example, to have feedback you sent deleted).
