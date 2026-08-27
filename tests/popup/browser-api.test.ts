import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserPopupApi } from '../../src/popup/browser-api';

afterEach(() => vi.unstubAllGlobals());

describe('browserPopupApi', () => {
  it('stores settings in the popup without opening another page', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { storage: { local: { set } } });

    await browserPopupApi.saveSettings({ deepgramApiKey: 'dg' } as never);

    expect(set).toHaveBeenCalledWith({ settings: { deepgramApiKey: 'dg' } });
  });
});
