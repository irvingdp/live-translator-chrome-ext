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
    permissions: [
      'activeTab',
      'offscreen',
      'sidePanel',
      'scripting',
      'storage',
      'tabCapture',
    ],
    host_permissions: [
      'https://api.deepgram.com/*',
      'https://api.deepl.com/*',
      'https://api-free.deepl.com/*',
      'https://generativelanguage.googleapis.com/*'
    ]
  }
});
