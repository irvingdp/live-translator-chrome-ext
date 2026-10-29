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
// Ratings at or above this go to the store; below it, to the feedback form.
export const STORE_RATING_MIN = 4;

export interface FeedbackPayload {
  rating: number;
  message: string;
  email?: string;
  version: string;
  provider: TranscriberId;
  uiLanguage: string;
}

export type FeedbackError = 'messageRequired' | 'messageTooLong' | 'emailInvalid';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateFeedback(message: string, email: string): FeedbackError | undefined {
  const text = message.trim();
  if (!text) return 'messageRequired';
  if (text.length > MAX_FEEDBACK_LENGTH) return 'messageTooLong';
  const address = email.trim();
  if (address && (address.length > 254 || !EMAIL.test(address))) return 'emailInvalid';
  return undefined;
}

// Only the fields listed here ever leave the device: no tab URL, no API key,
// no caption text.
export function buildFeedbackPayload(input: FeedbackPayload): FeedbackPayload {
  const email = input.email?.trim();
  return {
    rating: input.rating,
    message: input.message.trim().slice(0, MAX_FEEDBACK_LENGTH),
    ...(email ? { email } : {}),
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
