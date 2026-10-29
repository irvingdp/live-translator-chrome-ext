const WEBSITE_URL = 'https://irvingdp.github.io/live-translator-chrome-ext/';

// The site has an English root and a Traditional Chinese /zh-tw/ copy.
export function websiteUrl(uiLanguage: string): string {
  return uiLanguage.toLowerCase().startsWith('zh') ? `${WEBSITE_URL}zh-tw/` : WEBSITE_URL;
}
