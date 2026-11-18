// Allowed sites (GLOSSARY.md, ADR 0009): sites the viewer let read-ahead be
// ready on from page load. Allowing one grants its host permission (asked for
// in the popup, inside the viewer's click) and registers the MediaSource tap
// to run there at document_start. The registered scripts are the list; there
// is no second copy to drift.

export const MSE_TAP_FILE = 'read-ahead-mse-tap.js';
const SCRIPT_PREFIX = 'read-ahead-mse-tap@';

export interface SitesApi {
  permissions: {
    contains(permissions: { origins: string[] }): Promise<boolean>;
    remove(permissions: { origins: string[] }): Promise<boolean>;
  };
  scripting: {
    getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<Array<{ id: string }>>;
    registerContentScripts(scripts: Array<{
      allFrames?: boolean;
      id: string;
      js: string[];
      matches: string[];
      persistAcrossSessions?: boolean;
      runAt?: 'document_start';
      world?: 'MAIN';
    }>): Promise<void>;
    unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
  };
}

// The site a page belongs to, as read-ahead allows it: an https origin.
export function siteOrigin(url: string | undefined): string | undefined {
  try {
    const parsed = new URL(url ?? '');
    return parsed.protocol === 'https:' ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

export function sitePattern(origin: string): string {
  return `${origin}/*`;
}

const scriptId = (origin: string) => `${SCRIPT_PREFIX}${origin}`;

export async function allowedSites(api: SitesApi): Promise<string[]> {
  const scripts = await api.scripting.getRegisteredContentScripts();
  return scripts
    .filter((script) => script.id.startsWith(SCRIPT_PREFIX))
    .map((script) => script.id.slice(SCRIPT_PREFIX.length))
    .sort();
}

export async function isSiteAllowed(api: SitesApi, origin: string): Promise<boolean> {
  return (await allowedSites(api)).includes(origin);
}

// Registers the tap for `origin`, whose host permission the viewer just
// granted. Takes effect on the site's next page load.
export async function enableSite(api: SitesApi, origin: string): Promise<void> {
  if (!await api.permissions.contains({ origins: [sitePattern(origin)] })) {
    throw new Error('site_permission_missing');
  }
  if (await isSiteAllowed(api, origin)) return;
  await api.scripting.registerContentScripts([{
    allFrames: false,
    id: scriptId(origin),
    js: [MSE_TAP_FILE],
    matches: [sitePattern(origin)],
    persistAcrossSessions: true,
    runAt: 'document_start',
    world: 'MAIN',
  }]);
}

export async function disableSite(api: SitesApi, origin: string): Promise<void> {
  if (await isSiteAllowed(api, origin)) {
    await api.scripting.unregisterContentScripts({ ids: [scriptId(origin)] });
  }
  await api.permissions.remove({ origins: [sitePattern(origin)] }).catch(() => false);
}

// Drops registrations whose permission the viewer took away (in Chrome's own
// site settings, say), so nothing is left registered without consent.
export async function syncSites(api: SitesApi): Promise<void> {
  for (const origin of await allowedSites(api)) {
    if (!await api.permissions.contains({ origins: [sitePattern(origin)] })) {
      await api.scripting.unregisterContentScripts({ ids: [scriptId(origin)] });
    }
  }
}
