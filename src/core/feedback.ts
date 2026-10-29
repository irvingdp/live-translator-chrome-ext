// Sends optional user feedback to the developer's Google Apps Script, which
// writes it to a Sheet and emails it on. See feedback/README.md.
//
// The request is a no-cors text/plain POST: a "simple" request that needs no
// host permission, so shipping this adds no permission warning. The price is
// an opaque response — a resolved fetch means it reached the network, not
// that the script accepted it.

import type { TranscriberId } from './settings';

// Web app URL of the deployed Apps Script (feedback/apps-script.gs).
export const FEEDBACK_ENDPOINT =
  'https://script.google.com/macros/s/AKfycbzY17CDPPYzsXACmpaXBd3feOqofQ32STcMPJKAVMXaGBLP84Qp4X3OH7p_3gQw0UON/exec';

export const MAX_FEEDBACK_LENGTH = 2000;

// What the user picked under "what could be better?". Only "other" comes with
// free text.
export const FEEDBACK_ISSUES = ['inaccurate', 'delay', 'ui', 'other'] as const;
export type FeedbackIssue = (typeof FEEDBACK_ISSUES)[number];

export interface FeedbackPayload {
  rating: number;
  issue?: FeedbackIssue;
  message: string;
  version: string;
  provider: TranscriberId;
  uiLanguage: string;
}

export type FeedbackError = 'messageTooLong';

// The comment is optional: a rating on its own is worth sending.
export function validateFeedback(message: string): FeedbackError | undefined {
  return message.trim().length > MAX_FEEDBACK_LENGTH ? 'messageTooLong' : undefined;
}

// Only the fields listed here ever leave the device: no email, no tab URL, no
// API key, no caption text.
export function buildFeedbackPayload(input: FeedbackPayload): FeedbackPayload {
  const issue = FEEDBACK_ISSUES.find((value) => value === input.issue);
  return {
    rating: input.rating,
    ...(issue ? { issue } : {}),
    // Free text only accompanies "other"; anything typed before switching
    // away is dropped rather than sent.
    message: issue === 'other' ? input.message.trim().slice(0, MAX_FEEDBACK_LENGTH) : '',
    version: input.version,
    provider: input.provider,
    uiLanguage: input.uiLanguage,
  };
}

export async function sendFeedback(
  payload: FeedbackPayload,
  endpoint: string = FEEDBACK_ENDPOINT,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!endpoint) throw new Error('Feedback endpoint is not configured');
  await fetchImpl(endpoint, {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    method: 'POST',
    mode: 'no-cors',
  });
}
