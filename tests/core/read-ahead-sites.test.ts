import { describe, expect, it, vi } from 'vitest';

import {
  MSE_TAP_FILE,
  allowedSites,
  disableSite,
  enableSite,
  siteOrigin,
  syncSites,
  type SitesApi,
} from '../../src/core/read-ahead-sites';

function fakeApi(granted: string[] = []) {
  const registered: Array<{ id: string; matches: string[] }> = [];
  const grantedSet = new Set(granted);
  const api: SitesApi = {
    permissions: {
      contains: vi.fn(async ({ origins }) => origins.every((origin: string) => grantedSet.has(origin))),
      remove: vi.fn(async ({ origins }) => { origins.forEach((origin: string) => grantedSet.delete(origin)); return true; }),
    },
    scripting: {
      getRegisteredContentScripts: vi.fn(async () => registered.map(({ id }) => ({ id }))),
      registerContentScripts: vi.fn(async (scripts) => { registered.push(...scripts); }),
      unregisterContentScripts: vi.fn(async ({ ids }) => {
        for (const id of ids) registered.splice(registered.findIndex((script) => script.id === id), 1);
      }),
    },
  };
  return { api, grantedSet, registered };
}

describe('allowed sites', () => {
  it('only allows https sites, by origin', () => {
    expect(siteOrigin('https://www.bilibili.com/video/BV1?p=2')).toBe('https://www.bilibili.com');
    expect(siteOrigin('http://example.com/')).toBeUndefined();
    expect(siteOrigin('chrome://extensions')).toBeUndefined();
  });

  it('registers the tap at document_start in the MAIN world once the site is granted', async () => {
    const { api } = fakeApi(['https://www.bilibili.com/*']);
    await enableSite(api, 'https://www.bilibili.com');
    await enableSite(api, 'https://www.bilibili.com');
    expect(api.scripting.registerContentScripts).toHaveBeenCalledOnce();
    expect(api.scripting.registerContentScripts).toHaveBeenCalledWith([expect.objectContaining({
      js: [MSE_TAP_FILE],
      matches: ['https://www.bilibili.com/*'],
      persistAcrossSessions: true,
      runAt: 'document_start',
      world: 'MAIN',
    })]);
    expect(await allowedSites(api)).toEqual(['https://www.bilibili.com']);
  });

  it('refuses a site whose permission was not granted', async () => {
    const { api } = fakeApi();
    await expect(enableSite(api, 'https://www.bilibili.com')).rejects.toThrow('site_permission_missing');
    expect(api.scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  it('removing a site drops its registration and gives its permission back', async () => {
    const { api, grantedSet } = fakeApi(['https://www.bilibili.com/*']);
    await enableSite(api, 'https://www.bilibili.com');
    await disableSite(api, 'https://www.bilibili.com');
    expect(await allowedSites(api)).toEqual([]);
    expect(grantedSet.has('https://www.bilibili.com/*')).toBe(false);
  });

  it('drops registrations whose permission was taken away elsewhere', async () => {
    const { api, grantedSet } = fakeApi(['https://a.example/*', 'https://b.example/*']);
    await enableSite(api, 'https://a.example');
    await enableSite(api, 'https://b.example');
    grantedSet.delete('https://a.example/*');
    await syncSites(api);
    expect(await allowedSites(api)).toEqual(['https://b.example']);
  });
});
