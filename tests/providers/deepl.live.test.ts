import { describe, expect, it } from 'vitest';

import { DeepLClient } from '../../src/providers/deepl';

const environment = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};

const liveCases = [
  ['Free', environment.DEEPL_FREE_API_KEY],
  ['Pro', environment.DEEPL_PRO_API_KEY],
] as const;

describe('DeepL live compatibility gate', () => {
  it.runIf(environment.REQUIRE_LIVE_PROVIDER_KEYS === '1')(
    'requires both Free and Pro credentials in release mode',
    () => {
      expect(environment.DEEPL_FREE_API_KEY, 'Missing DeepL Free key').toBeTruthy();
      expect(environment.DEEPL_PRO_API_KEY, 'Missing DeepL Pro key').toBeTruthy();
    },
  );
  for (const [plan, apiKey] of liveCases) {
    it.skipIf(!apiKey)(`${plan} accepts direct latency-optimized requests`, async () => {
      const result = await new DeepLClient().translate({
        apiKey: apiKey!,
        sourceLanguage: 'EN',
        targetLanguage: 'DE',
        text: 'Hello',
      });

      expect(result.text.trim()).not.toBe('');
    });
  }
});
