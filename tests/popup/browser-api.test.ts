import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserPopupApi } from '../../src/popup/browser-api';

afterEach(() => vi.unstubAllGlobals());

describe('browserPopupApi', () => {
  it('opens the Chrome extension options page', async () => {
    const openOptionsPage = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { runtime: { openOptionsPage } });

    await browserPopupApi.openOptions();

    expect(openOptionsPage).toHaveBeenCalledOnce();
  });
});
