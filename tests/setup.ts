import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import zhTW from '../public/_locales/zh_TW/messages.json';

// Resolved from the real catalogue rather than a hand-written map, so a test
// asserting on a string is asserting on the string that actually ships. zh_TW
// is the locale under test because that is what the assertions are written in;
// key coverage for the default locale is checked by tests/core/i18n.test.ts.
const catalogue = zhTW as Record<string, { message: string }>;

function getMessage(key: string, substitutions?: string | string[]): string {
  const message = catalogue[key]?.message;
  if (message === undefined) return '';
  const values = Array.isArray(substitutions)
    ? substitutions
    : substitutions === undefined
      ? []
      : [substitutions];
  return message.replace(/\$(\d)/g, (match, index: string) => {
    const value = values[Number(index) - 1];
    return value === undefined ? match : value;
  });
}

// Individual tests are free to vi.stubGlobal('chrome', ...) over this; those
// that do exercise code with no user-facing strings.
beforeEach(() => {
  vi.stubGlobal('chrome', {
    ...(globalThis as { chrome?: object }).chrome,
    i18n: { getMessage, getUILanguage: () => 'zh-TW' },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});
