import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

// ONNX Runtime's WebAssembly for Local Whisper (issue #15), shipped with the
// extension: an extension page may not load code from a CDN.
const ORT_FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];

export default defineConfig({
  outDir: 'output',
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      for (const file of ORT_FILES) {
        files.push({
          absoluteSrc: resolve('node_modules/onnxruntime-web/dist', file),
          relativeDest: `ort/${file}`,
        });
      }
    },
  },
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
    // Groq is asked for only when the user picks it
    // (read-ahead, issue #11),
    // so adding it does not disable the extension on update.
    optional_host_permissions: [
      'https://api.groq.com/*',
      // Read-ahead's fallback when Chrome's built-in Translator cannot
      // translate: Google's web translation.
      'https://translate.googleapis.com/*',
      // Allowed sites (ADR 0009): declared broadly so the popup can ask for
      // the one site the viewer allows, never granted all at once.
      'https://*/*',
    ],
    host_permissions: [
      'https://generativelanguage.googleapis.com/*'
    ],
    // Local Whisper (issue #15) runs ONNX Runtime's WebAssembly in the
    // offscreen document. MV3's default CSP does not allow compiling it;
    // 'wasm-unsafe-eval' allows WebAssembly only, not eval or remote code.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  }
});
