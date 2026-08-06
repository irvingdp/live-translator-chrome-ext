import { describe, expect, it, vi } from 'vitest';

import en from '../../public/_locales/en/messages.json';
import zhTW from '../../public/_locales/zh_TW/messages.json';
import { applyDocumentLanguage, t } from '../../src/core/i18n';

type Catalogue = Record<
  string,
  { description?: string; message: string; placeholders?: unknown }
>;

const locales: Array<[string, Catalogue]> = [
  ['en', en as Catalogue],
  ['zh_TW', zhTW as Catalogue],
];

describe('message catalogues', () => {
  // The one failure mode that no component test can catch: a string added to
  // one locale and forgotten in the other renders as an empty label for
  // everyone using the locale that was missed.
  it('define exactly the same keys in every locale', () => {
    const [, reference] = locales[0]!;
    const expected = Object.keys(reference).sort();
    for (const [name, catalogue] of locales) {
      expect(Object.keys(catalogue).sort(), name).toEqual(expected);
    }
  });

  it('never ship an empty message', () => {
    for (const [name, catalogue] of locales) {
      for (const [key, entry] of Object.entries(catalogue)) {
        expect(entry.message.trim(), `${name}.${key}`).not.toBe('');
      }
    }
  });

  // A translator working from the description alone cannot see the call site,
  // so every key has to explain itself.
  it('describe every key for whoever translates it next', () => {
    for (const [name, catalogue] of locales) {
      for (const [key, entry] of Object.entries(catalogue)) {
        expect(entry.description?.trim(), `${name}.${key}`).toBeTruthy();
      }
    }
  });

  it('use the same substitution slots in every locale', () => {
    const slots = (message: string) =>
      [...message.matchAll(/\$\d/g)].map((match) => match[0]).sort();
    const [, reference] = locales[0]!;
    for (const [name, catalogue] of locales) {
      for (const [key, entry] of Object.entries(catalogue)) {
        expect(slots(entry.message), `${name}.${key}`).toEqual(
          slots(reference[key]!.message),
        );
      }
    }
  });

  // The store rejects anything longer, and the manifest is generated from this.
  it('keep the store description within the 132-character limit', () => {
    for (const [name, catalogue] of locales) {
      expect(catalogue.extDescription!.message.length, name).toBeLessThanOrEqual(
        132,
      );
    }
  });
});

describe('t', () => {
  it('resolves a message and fills its substitutions', () => {
    expect(t('providerSignupLink', 'aistudio.google.com')).toContain(
      'aistudio.google.com',
    );
  });

  // Better a visible key than the empty string chrome.i18n hands back, which
  // just looks like a broken layout.
  it('falls back to the key when there is no i18n bridge', () => {
    vi.stubGlobal('chrome', undefined);
    expect(t('startCaptions')).toBe('startCaptions');
  });
});

describe('applyDocumentLanguage', () => {
  // The tag comes from the catalogue, so it names the language actually on
  // screen rather than the browser's UI language, which can differ.
  it('labels the document with the language it rendered in', () => {
    applyDocumentLanguage(document);
    expect(document.documentElement.lang).toBe('zh-Hant-TW');
  });

  it('leaves the document alone when there is no i18n bridge', () => {
    document.documentElement.lang = 'en';
    vi.stubGlobal('chrome', undefined);

    applyDocumentLanguage(document);

    expect(document.documentElement.lang).toBe('en');
  });
});
