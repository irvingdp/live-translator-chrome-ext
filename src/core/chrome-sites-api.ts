// chrome.* behind SitesApi (read-ahead-sites.ts), for every extension page
// and the background.
import type { SitesApi } from './read-ahead-sites';

export const chromeSitesApi: SitesApi = {
  permissions: {
    contains: (permissions) => chrome.permissions.contains(permissions),
    remove: (permissions) => chrome.permissions.remove(permissions),
  },
  scripting: {
    getRegisteredContentScripts: (filter) => chrome.scripting.getRegisteredContentScripts(filter),
    registerContentScripts: (scripts) => chrome.scripting.registerContentScripts(scripts),
    unregisterContentScripts: (filter) => chrome.scripting.unregisterContentScripts(filter),
  },
};
