import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RatingPromptState } from '../../src/core/rating-prompt';
import { browserPopupApi } from '../../src/popup/browser-api';

afterEach(() => vi.unstubAllGlobals());

describe('browserPopupApi', () => {
  it('authorizes the current HTTPS tab when the popup opens', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
      tabs: {
        query: vi.fn().mockResolvedValue([{
          id: 43,
          url: 'https://example.com/watch',
        }]),
      },
    });

    await browserPopupApi.authorizeCurrentTab();

    expect(sendMessage).toHaveBeenCalledWith({
      target: 'background',
      type: 'SESSION_AUTHORIZE_TAB',
      payload: { tabId: 43 },
    });
  });

  it('lets the background clear authorization hints on restricted tabs', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ authorized: false, ok: true });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 44, url: 'chrome://settings' }]),
      },
    });

    await expect(browserPopupApi.authorizeCurrentTab()).resolves.toEqual({
      authorized: false,
      tabId: 44,
    });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      payload: { tabId: 44 },
      type: 'SESSION_AUTHORIZE_TAB',
    }));
  });

  it('stores settings in the popup without opening another page', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { storage: { local: { set } } });

    await browserPopupApi.saveSettings({ geminiApiKey: 'gm' } as never);

    expect(set).toHaveBeenCalledWith({ settings: { geminiApiKey: 'gm' } });
  });

  it('hands out the Deepgram-removed notice once', async () => {
    const data: Record<string, unknown> = { deepgramRemovedNotice: true };
    const get = vi.fn(async (key: string) => ({ [key]: data[key] }));
    const remove = vi.fn(async (key: string) => { delete data[key]; });
    vi.stubGlobal('chrome', { storage: { local: { get, remove } } });

    await expect(browserPopupApi.takeDeepgramRemovedNotice()).resolves.toBe(true);
    await expect(browserPopupApi.takeDeepgramRemovedNotice()).resolves.toBe(false);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('keeps the rating prompt state in local storage', async () => {
    const get = vi.fn().mockResolvedValue({ ratingPrompt: { started: true, tabCount: 2 } });
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { storage: { local: { get, set } } });

    await expect(browserPopupApi.loadRatingPrompt()).resolves.toMatchObject({
      started: true,
      status: 'pending',
      tabCount: 2,
    });
    const state: RatingPromptState = { recentTabIds: [], started: true, status: 'done', tabCount: 2 };
    await browserPopupApi.saveRatingPrompt(state);
    expect(set).toHaveBeenCalledWith({ ratingPrompt: state });
  });

  it("starts a viewer who never chose a recognizer on Groq Whisper, WebGPU or not, keeping a choice", async () => {
    const load = async (stored: unknown, gpu: boolean) => {
      vi.stubGlobal('chrome', { storage: { local: { get: vi.fn().mockResolvedValue({ settings: stored }) } } });
      vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn().mockResolvedValue(gpu ? {} : null) } });
      return (await browserPopupApi.loadSettings()).readAheadRecognizer;
    };
    await expect(load(undefined, true)).resolves.toBe('groq');
    await expect(load({ transcriber: 'gemini' }, false)).resolves.toBe('groq');
    await expect(load({ readAheadRecognizer: 'local' }, false)).resolves.toBe('local');
    // Gemini is no longer a read-ahead recognizer (ADR 0012).
    await expect(load({ readAheadRecognizer: 'gemini' }, true)).resolves.toBe('groq');
  });
});
