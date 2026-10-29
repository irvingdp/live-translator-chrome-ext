/**
 * Receives feedback from the Bilingual Live Captions popup.
 *
 * Bound to a Google Sheet: each submission becomes a row, and an email goes to
 * RECIPIENT. Deploy as a web app (Execute as: Me, Who has access: Anyone) and
 * paste the /exec URL into FEEDBACK_ENDPOINT in src/core/feedback.ts.
 *
 * The extension posts with mode: 'no-cors', so it never reads the response;
 * the plain-text replies below are only for testing by hand.
 */

const RECIPIENT = 'irvingdp@gmail.com';
// Shared across all users; a burst beyond this is dropped, not queued.
const MAX_PER_MINUTE = 10;
const MAX_MESSAGE = 2000;
const HEADERS = ['Received', 'Rating', 'Message', 'Email', 'Version', 'Provider', 'UI language'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return reply('busy');
  try {
    if (overLimit()) return reply('rate_limited');

    let data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (error) {
      return reply('bad_request');
    }

    const rating = Number(data.rating);
    const message = String(data.message || '').trim().slice(0, MAX_MESSAGE);
    if (!(rating >= 1 && rating <= 5) || !message) return reply('bad_request');
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email || ''))
      ? String(data.email).slice(0, 254)
      : '';
    const version = clip(data.version, 20);
    const provider = clip(data.provider, 20);
    const uiLanguage = clip(data.uiLanguage, 20);

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
    // Leading = + - @ would make Sheets treat user text as a formula.
    sheet.appendRow([new Date(), rating, safeCell(message), safeCell(email), version, provider, uiLanguage]);

    const mail = {
      to: RECIPIENT,
      subject: `[Bilingual Live Captions] ${rating}★ feedback (v${version})`,
      body: [
        `Rating: ${rating}/5`,
        `Provider: ${provider}`,
        `UI language: ${uiLanguage}`,
        `Version: ${version}`,
        `Reply-to: ${email || '(none)'}`,
        '',
        message,
      ].join('\n'),
    };
    if (email) mail.replyTo = email;
    MailApp.sendEmail(mail);
    return reply('ok');
  } finally {
    lock.releaseLock();
  }
}

function overLimit() {
  const cache = CacheService.getScriptCache();
  const key = `count:${Math.floor(Date.now() / 60000)}`;
  const count = Number(cache.get(key) || 0);
  if (count >= MAX_PER_MINUTE) return true;
  cache.put(key, String(count + 1), 120);
  return false;
}

function clip(value, length) {
  return String(value || '').slice(0, length);
}

function safeCell(text) {
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function reply(text) {
  return ContentService.createTextOutput(text);
}
