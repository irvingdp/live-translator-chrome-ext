# Extension Surfaces

WXT generates Chrome extension documents rather than URL routes. There is no router configuration.

| Surface | Generated document / trigger | Entry | Rendered UI |
|---|---|---|---|
| Toolbar popup | `popup.html` | `entrypoints/popup/main.tsx` | `src/popup/PopupApp.tsx` |
| Extension options | `options.html` | `entrypoints/options/main.tsx` | `src/options/OptionsApp.tsx` |
| Page captions | injected content script | `entrypoints/captions.ts` | `src/content/caption-overlay.ts` |
| Audio worker | offscreen extension document | `entrypoints/offscreen/*` | no user-facing UI |

## Manifest configuration

Path: `wxt.config.ts`

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: 'output',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    default_locale: 'en',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    minimum_chrome_version: '116',
    permissions: ['activeTab', 'offscreen', 'scripting', 'storage', 'tabCapture'],
    host_permissions: [
      'https://api.deepgram.com/*',
      'https://api.deepl.com/*',
      'https://api-free.deepl.com/*',
      'https://generativelanguage.googleapis.com/*'
    ]
  }
});
```

The planned native Chrome Side Panel does not exist in the current baseline.
