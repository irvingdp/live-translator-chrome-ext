import { describe, expect, it, vi } from 'vitest';

import {
  MAX_FEEDBACK_LENGTH,
  buildFeedbackPayload,
  sendFeedback,
  validateFeedback,
} from '../../src/core/feedback';

const base = {
  message: '  The captions lag on long videos.  ',
  provider: 'gemini' as const,
  rating: 2,
  uiLanguage: 'zh-TW',
  version: '1.4.0',
};

describe('feedback', () => {
  it('accepts a rating with no comment and caps the comment length', () => {
    expect(validateFeedback('   ')).toBeUndefined();
    expect(validateFeedback('ok')).toBeUndefined();
    expect(validateFeedback('x'.repeat(MAX_FEEDBACK_LENGTH + 1))).toBe('messageTooLong');
  });

  it('sends only the listed fields, never an email', () => {
    const payload = buildFeedbackPayload({
      ...base,
      // Anything else a caller passes along must not leak out.
      ...({ apiKey: 'secret', email: 'me@example.com', tabUrl: 'https://private.example' } as object),
    });

    expect(payload).toEqual({
      message: 'The captions lag on long videos.',
      provider: 'gemini',
      rating: 2,
      uiLanguage: 'zh-TW',
      version: '1.4.0',
    });
  });

  it('posts a no-cors text/plain request, which needs no host permission', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null));
    const payload = buildFeedbackPayload(base);

    await sendFeedback(payload, 'https://script.example/exec', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith('https://script.example/exec', {
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      method: 'POST',
      mode: 'no-cors',
    });
  });

  it('fails loudly when no endpoint is configured or the network is down', async () => {
    const payload = buildFeedbackPayload(base);

    await expect(sendFeedback(payload, '', vi.fn())).rejects.toThrow('not configured');
    await expect(
      sendFeedback(payload, 'https://script.example/exec', vi.fn().mockRejectedValue(new TypeError('offline'))),
    ).rejects.toThrow('offline');
  });
});
