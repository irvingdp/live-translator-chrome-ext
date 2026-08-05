import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { browserOptionsApi } from '../../src/options/browser-api';

afterEach(() => vi.unstubAllGlobals());

describe('browserOptionsApi', () => {
  it('loads only the normalized API Key fields', async () => {
    const get = vi.fn().mockResolvedValue({
      settings: {
        ...DEFAULT_SETTINGS,
        deepgramApiKey: 'dg-existing',
        deeplApiKey: 'dl-existing',
      },
    });
    vi.stubGlobal('chrome', { storage: { local: { get, set: vi.fn() } } });

    await expect(browserOptionsApi.loadKeys()).resolves.toEqual({
      deepgramApiKey: 'dg-existing',
      deeplApiKey: 'dl-existing',
    });
    expect(get).toHaveBeenCalledWith('settings');
  });

  it('merges API Keys without overwriting popup settings', async () => {
    const existing = {
      ...DEFAULT_SETTINGS,
      originalFontSize: 32,
      sourceLanguage: 'JA',
      sourceLocale: 'ja',
      targetLanguage: 'ZH-HANT',
      translationFontSize: 28,
    };
    const get = vi.fn().mockResolvedValue({ settings: existing });
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { storage: { local: { get, set } } });

    await browserOptionsApi.saveKeys({
      deepgramApiKey: 'dg-new',
      deeplApiKey: 'dl-new',
    });

    expect(set).toHaveBeenCalledWith({
      settings: {
        ...existing,
        deepgramApiKey: 'dg-new',
        deeplApiKey: 'dl-new',
      },
    });
  });
});
