# Feedback endpoint

The popup's rating card sends every rating, with an optional comment, to a
Google Apps Script web app. The script writes each submission to a Google Sheet and emails it to
irvingdp@gmail.com. There is no other backend.

## What is sent

`rating`, `message`, optional `email`, `version`, `provider`, `uiLanguage` —
nothing else (see `buildFeedbackPayload` in `src/core/feedback.ts`). No tab URL,
API key or caption text.

## Set up (once)

1. Create a Google Sheet, e.g. "Bilingual Live Captions feedback".
2. In the Sheet: **Extensions → Apps Script**. Replace the default code with
   `apps-script.gs` from this folder and save.
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. In the editor, pick the `authorize` function and press **Run**, then accept
   the prompt (Sheets and Gmail send access). Skipping this makes every request
   fail with "你沒有呼叫 SpreadsheetApp.getActiveSpreadsheet 的權限".
5. Copy the web app URL (ends in `/exec`) into `FEEDBACK_ENDPOINT` in
   `src/core/feedback.ts`.

To check it by hand:

```bash
curl -L -H 'Content-Type: text/plain' \
  -d '{"rating":2,"message":"test","version":"dev","provider":"gemini","uiLanguage":"en"}' \
  '<web app URL>'
```

A new row and an email should arrive.

## Updating the script

Edit, then **Deploy → Manage deployments → Edit → Version: New version**. This
keeps the same `/exec` URL, so the extension does not need a new release.

## Abuse

The URL ships inside the extension, so anyone can find it. The script caps
submissions at 10 per minute across everyone and neutralises spreadsheet
formulas. If it is ever flooded, put a Cloudflare Worker with per-client rate
limits in front of it.
