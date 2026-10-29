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

    await browserPopupApi.saveSettings({ deepgramApiKey: 'dg' } as never);

    expect(set).toHaveBeenCalledWith({ settings: { deepgramApiKey: 'dg' } });
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
});
