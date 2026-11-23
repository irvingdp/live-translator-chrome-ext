import { readFile } from 'node:fs/promises';

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('Usage: verify-manifest.mjs <manifest.json>');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
// The one persistent content script is the player button (ADR 0013): YouTube
// and Bilibili only, in the isolated world, reading only where the player's
// controls are. Everything else is injected on demand.
const PLAYER_BUTTON_MATCHES = ['https://www.bilibili.com/*', 'https://www.youtube.com/*'];
const contentScripts = manifest.content_scripts ?? [];
const playerButtonOnly = contentScripts.every((script) =>
  JSON.stringify([...(script.matches ?? [])].sort()) === JSON.stringify(PLAYER_BUTTON_MATCHES) &&
  JSON.stringify(script.js) === JSON.stringify(['content-scripts/player-button.js']) &&
  !script.css &&
  script.world !== 'MAIN' &&
  !script.all_frames);
if (contentScripts.length > 1 || !playerButtonOnly) {
  throw new Error(`Unexpected content scripts: ${JSON.stringify(contentScripts)}`);
}

// Only WebAssembly is allowed beyond 'self' (Local Whisper, ADR 0008): no
// eval, no remote script.
const expectedExtensionPagesCsp = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';";
if (manifest.content_security_policy?.extension_pages !== expectedExtensionPagesCsp) {
  throw new Error(
    `Unexpected extension_pages CSP: ${JSON.stringify(manifest.content_security_policy)}`,
  );
}

const expectedProviderHosts = [
  'https://generativelanguage.googleapis.com/*',
].sort();
const actualProviderHosts = [...(manifest.host_permissions ?? [])].sort();
if (JSON.stringify(actualProviderHosts) !== JSON.stringify(expectedProviderHosts)) {
  throw new Error(
    `Unexpected host permissions: ${JSON.stringify(actualProviderHosts)}`,
  );
}

// Hosts asked for at runtime, when the user picks that provider.
const expectedOptionalHosts = [
  'https://translate.googleapis.com/*',
  'https://api.groq.com/*',
  // Allowed sites for read-ahead (ADR 0009): only the one site the viewer
  // allows is ever requested at runtime.
  'https://*/*',
].sort();
const actualOptionalHosts = [...(manifest.optional_host_permissions ?? [])].sort();
if (JSON.stringify(actualOptionalHosts) !== JSON.stringify(expectedOptionalHosts)) {
  throw new Error(
    `Unexpected optional host permissions: ${JSON.stringify(actualOptionalHosts)}`,
  );
}

const broadPatterns = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*']);
// The optional https://*/* above is the one exception: it is only a ceiling
// for per-site requests. Granted host access and content scripts stay narrow.
const declaredPatterns = [
  ...(manifest.host_permissions ?? []),
  ...(manifest.optional_host_permissions ?? []).filter((pattern) => pattern !== 'https://*/*'),
];
for (const registration of manifest.content_scripts ?? []) {
  declaredPatterns.push(...(registration.matches ?? []));
}
const broadPattern = declaredPatterns.find((pattern) => broadPatterns.has(pattern));
if (broadPattern) throw new Error(`Broad host access is forbidden: ${broadPattern}`);

console.info('Manifest security check passed');
