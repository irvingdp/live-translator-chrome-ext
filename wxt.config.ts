import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: 'output',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '雙語即時字幕翻譯',
    description: '擷取目前分頁音訊並顯示可調整大小的雙語即時字幕。',
    minimum_chrome_version: '116',
      permissions: ['activeTab', 'offscreen', 'storage', 'tabCapture'],
    host_permissions: [
      'https://api.deepgram.com/*',
      'https://api.deepl.com/*',
      'https://api-free.deepl.com/*'
    ]
  }
});
