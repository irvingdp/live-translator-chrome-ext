import { readFile } from 'node:fs/promises';

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('Usage: verify-manifest.mjs <manifest.json>');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if ((manifest.content_scripts?.length ?? 0) > 0) {
  throw new Error('Manifest must not register persistent content scripts');
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
].sort();
const actualOptionalHosts = [...(manifest.optional_host_permissions ?? [])].sort();
if (JSON.stringify(actualOptionalHosts) !== JSON.stringify(expectedOptionalHosts)) {
  throw new Error(
    `Unexpected optional host permissions: ${JSON.stringify(actualOptionalHosts)}`,
  );
}

const broadPatterns = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*']);
const declaredPatterns = [
  ...(manifest.host_permissions ?? []),
  ...(manifest.optional_host_permissions ?? []),
];
for (const registration of manifest.content_scripts ?? []) {
  declaredPatterns.push(...(registration.matches ?? []));
}
const broadPattern = declaredPatterns.find((pattern) => broadPatterns.has(pattern));
if (broadPattern) throw new Error(`Broad host access is forbidden: ${broadPattern}`);

console.info('Manifest security check passed');
