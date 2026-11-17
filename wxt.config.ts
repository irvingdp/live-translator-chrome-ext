import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: 'output',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    // Resolved from public/_locales at load time. English is the default so a
    // store visitor who reads neither language at least gets one they can
    // search for; zh_TW users see the Chinese name. Note the UI itself is
    // still Chinese only — the English listing says so.
    default_locale: 'en',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    minimum_chrome_version: '116',
    // Shown as the "Website" link on the store listing and chrome://extensions.
    homepage_url: 'https://irvingdp.github.io/live-translator-chrome-ext/',
    permissions: [
      'activeTab',
      'offscreen',
      'sidePanel',
      'scripting',
      'storage',
      'tabCapture',
    ],
    // Groq and Cloudflare are asked for only when the user picks them
    // (read-ahead, issue #11),
    // so adding it does not disable the extension on update.
    optional_host_permissions: [
      'https://api.groq.com/*',
      'https://api.cloudflare.com/*',
      // Read-ahead's fallback when Chrome's built-in Translator cannot
      // translate: Google's web translation.
      'https://translate.googleapis.com/*',
    ],
    host_permissions: [
      'https://generativelanguage.googleapis.com/*'
    ]
  }
});
