import { defineConfig } from 'astro/config';

// Served from GitHub Pages as a project site.
export default defineConfig({
  site: 'https://irvingdp.github.io',
  base: '/live-translator-chrome-ext',
  trailingSlash: 'ignore',
  i18n: {
    locales: ['en', 'zh-tw'],
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: false },
  },
});
