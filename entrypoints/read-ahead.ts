import { installReadAhead } from '../src/read-ahead/read-ahead-content';

// Injected by the background when a read-ahead session starts (no persistent
// content scripts: scripts/verify-manifest.mjs).
export default defineUnlistedScript(() => {
  installReadAhead(document);
});
