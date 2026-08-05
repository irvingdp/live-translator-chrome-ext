import { describe, expect, it } from 'vitest';

import { ensureContentScript } from '../../src/core/content-script-loader';

describe('ensureContentScript', () => {
  it('keeps an existing tab receiver without injecting another script', async () => {
    const calls: string[] = [];

    await ensureContentScript({
      inject: async () => { calls.push('inject'); },
      ping: async () => {
        calls.push('ping');
        return { ok: true };
      },
    });

    expect(calls).toEqual(['ping']);
  });

  it('injects the content script when the tab has no receiver', async () => {
    const calls: string[] = [];
    let pingAttempt = 0;

    await ensureContentScript({
      inject: async () => { calls.push('inject'); },
      ping: async () => {
        calls.push('ping');
        pingAttempt += 1;
        if (pingAttempt === 1) {
          throw new Error('Receiving end does not exist');
        }
        return { ok: true };
      },
    });

    expect(calls).toEqual(['ping', 'inject', 'ping']);
  });

  it('rejects startup when the injected receiver never becomes ready', async () => {
    await expect(ensureContentScript({
      inject: async () => undefined,
      ping: async () => undefined,
    })).rejects.toThrow('content_script_unavailable');
  });
});
