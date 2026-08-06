// The message catalogue lives in public/_locales, which is also what Chrome
// reads at runtime — there is no second copy to drift out of sync. Typing the
// keys off the default locale means a call site naming a message that does not
// exist fails to compile rather than rendering an empty label.
type Catalogue = typeof import('../../public/_locales/en/messages.json');

export type MessageKey = keyof Catalogue;

// chrome.i18n is present in every context this extension runs in — popup,
// options, content script, background, offscreen — but not in a bare unit test
// or a plain page, so the lookup is guarded.
function bridge(): typeof chrome.i18n | undefined {
  return (globalThis as { chrome?: typeof chrome }).chrome?.i18n;
}

// Returns the key itself when a message cannot be resolved. An untranslated
// key on screen is obvious and traceable; the empty string chrome.i18n returns
// for a missing message just looks like a layout bug.
export function t(key: MessageKey, ...substitutions: string[]): string {
  return bridge()?.getMessage(key, substitutions) || key;
}

// Lets the page declare the language it actually rendered in, which is what
// the browser uses to pick font and line-breaking rules for CJK.
//
// Deliberately not chrome.i18n.getUILanguage(): that reports the browser's UI
// language, which is not the catalogue Chrome resolved. A French browser has
// no _locales/fr, so it reads the English messages while getUILanguage() still
// says "fr" — labelling English text as French. The tag travels in the
// catalogue instead, so it can only ever name the language on screen.
export function applyDocumentLanguage(document: Document): void {
  const language = bridge() ? t('uiLanguage') : undefined;
  if (language) document.documentElement.lang = language;
}
