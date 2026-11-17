import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { browserOptionsApi } from '../../src/options/browser-api';

afterEach(() => vi.unstubAllGlobals());

describe('browserOptionsApi', () => {
  it('loads only the normalized API Key fields', async () => {
    const get = vi.fn().mockResolvedValue({
      settings: {
        ...DEFAULT_SETTINGS,
        geminiApiKey: 'gm-existing',
      },
    });
    vi.stubGlobal('chrome', { storage: { local: { get, set: vi.fn() } } });

    await expect(browserOptionsApi.loadKeys()).resolves.toEqual({
      geminiApiKey: 'gm-existing',
      groqApiKey: '',
    });
    expect(get).toHaveBeenCalledWith('settings');
  });

  it('merges API Keys without overwriting popup settings', async () => {
    const existing = {
      ...DEFAULT_SETTINGS,
      geminiTargetLanguage: 'ja',
      originalFontSize: 32,
      translationFontSize: 28,
    };
    const get = vi.fn().mockResolvedValue({ settings: existing });
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { storage: { local: { get, set } } });

    await browserOptionsApi.saveKeys({
      geminiApiKey: 'gm-new',
      groqApiKey: 'gq-new',
    });

    expect(set).toHaveBeenCalledWith({
      settings: {
        ...existing,
        geminiApiKey: 'gm-new',
        groqApiKey: 'gq-new',
      },
    });
  });
});
