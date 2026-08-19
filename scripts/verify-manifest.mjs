import { readFile } from 'node:fs/promises';

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('Usage: verify-manifest.mjs <manifest.json>');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if ((manifest.content_scripts?.length ?? 0) > 0) {
  throw new Error('Manifest must not register persistent content scripts');
}

const expectedProviderHosts = [
  'https://api.deepgram.com/*',
  'https://api.deepl.com/*',
  'https://api-free.deepl.com/*',
  'https://generativelanguage.googleapis.com/*',
].sort();
const actualProviderHosts = [...(manifest.host_permissions ?? [])].sort();
if (JSON.stringify(actualProviderHosts) !== JSON.stringify(expectedProviderHosts)) {
  throw new Error(
    `Unexpected host permissions: ${JSON.stringify(actualProviderHosts)}`,
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
