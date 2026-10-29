import { fileURLToPath } from 'node:url';
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
  vite: {
    // Pin our own tsconfig; otherwise Vite also picks up the extension's root
    // tsconfig, which extends a file WXT only generates after its npm install.
    tsconfig: fileURLToPath(new URL('./tsconfig.json', import.meta.url)),
  },
});
