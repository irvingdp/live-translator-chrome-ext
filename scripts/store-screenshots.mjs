// Generates the Chrome Web Store listing images from the real built extension,
// so the screenshots can never drift from what actually ships. Run after a
// build: `npm run build && npm run screenshots`.
//
// The captions are driven through the built content bundle's real message
// listener rather than by a live provider session: that needs no API key, no
// network, and no third-party video whose frames we would not be allowed to
// publish.
import { chromium } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const built = join(root, 'output', 'chrome-mv3');
const LOCALE = process.argv[2] ?? 'en';
const outDir = join(root, 'docs', 'store-assets', '1.2.0', LOCALE);

// The Chrome Web Store shows one screenshot set to every visitor regardless of
// listing language, so these are shot in the default locale to match the
// English copy on the images. Chromium takes its UI language from the OS on
// macOS and ignores --lang, so the locale is forced by giving the copy it
// loads only one catalogue to choose from.
const extension = mkdtempSync(join(tmpdir(), `ext-${LOCALE}-`));
cpSync(built, extension, { recursive: true });
if (LOCALE !== 'en') {
  cpSync(
    join(extension, '_locales', LOCALE, 'messages.json'),
    join(extension, '_locales', 'en', 'messages.json'),
  );
}
for (const name of readdirSync(join(extension, '_locales'))) {
  if (name !== 'en') {
    rmSync(join(extension, '_locales', name), { recursive: true });
  }
}

// The store crops nothing, so this is exactly what a visitor sees.
const SHOT = { height: 800, width: 1280 };
const PROMO = { height: 280, width: 440 };
// Breathing room kept above and below a cropped panel region.
const PANEL_PADDING = 14;

const COPY = LOCALE === 'zh_TW'
  ? {
      floatingBody: '字幕可自由移動，從四個圓角縮放；拉高後會自動顯示更多完整雙語字幕。',
      floatingHeading: '拖到哪裡，都由你決定',
      optionsBody: '使用自己的 API 金鑰。資料只保存在這台裝置的 Chrome 本機儲存空間，<span class="accent">不會傳送到我們的伺服器</span>。',
      optionsHeading: '你的金鑰，留在你的裝置',
      popupDeepgramBody: '字體大小、文字顏色、背景透明度與斷句長度，都能在<span class="accent">字幕運作期間即時調整</span>。',
      popupDeepgramHeading: '不中斷字幕，也能隨時微調',
      popupGeminiBody: '一組 Google API 金鑰，一條連線同時取得原文與翻譯，支援 <span class="accent">78 種語言</span>。',
      popupGeminiHeading: '選擇服務，開始即時翻譯',
      sidebarBody: '把字幕釘到 Chrome 側邊欄，閱讀完整雙語紀錄，並自動跟隨最新內容。',
      sidebarHeading: '逐句字幕，釘選在側邊',
    }
  : {
      floatingBody: 'Drag captions anywhere and resize from four rounded corners. Taller surfaces reveal more complete bilingual lines.',
      floatingHeading: 'Move it. Resize it. Make captions yours.',
      optionsBody: 'Bring your own key. It is stored in local Chrome storage on this device and <span class="accent">never sent to us</span> — there is no server.',
      optionsHeading: 'Your keys stay<br>on your machine',
      popupDeepgramBody: 'Font sizes, text colors, opacity and line length — all of it <span class="accent">updates while captions run</span>.',
      popupDeepgramHeading: 'Tune the captions<br>without stopping',
      popupGeminiBody: 'One Google API key. A single connection returns the original speech and its translation together, in <span class="accent">78 languages</span>.',
      popupGeminiHeading: 'Pick a provider,<br>pick a language',
      sidebarBody: 'Pin captions to Chrome’s Side Panel for readable bilingual history that automatically follows the latest line.',
      sidebarHeading: 'Every line,<br>right by your side',
    };

const SAMPLE = {
  original:
    'So we created Vera CPU for the age of AI. Now, inside our system, it is used for three different ways.',
  translation:
    '所以我們創建了 Vera CPU，專為 AI 時代設計。現在，在我們的系統中，它用於三種不同的方式。',
};

const SIDEBAR_SAMPLE = [
  {
    id: 'turn-0',
    original: 'Every breakthrough starts with a question.',
    translation: '每一次突破，都從一個問題開始。',
  },
  {
    id: 'turn-1',
    original: 'How can technology help people understand each other?',
    translation: '科技要如何幫助人們理解彼此？',
  },
  {
    id: 'turn-2',
    original: 'Live captions make every conversation easier to follow.',
    translation: '即時字幕，讓每段對話都更容易閱讀。',
  },
  {
    id: 'turn-3',
    original: 'Read the original and translation together, one sentence at a time.',
    translation: '原文與譯文逐句對照，一眼就能掌握內容。',
  },
];

// A stand-in for a video player. Nothing here is anyone else's footage.
const STAGE_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Bilingual Live Captions</title>
<style>
  html, body { margin: 0; height: 100%; background: #05070d; }
  .player {
    position: relative; height: 100vh; width: 100vw; overflow: hidden;
    background:
      radial-gradient(120% 90% at 22% 18%, #1d3a5c 0%, transparent 55%),
      radial-gradient(90% 80% at 82% 78%, #3a2450 0%, transparent 60%),
      linear-gradient(155deg, #0a1220 0%, #060a12 60%, #04060b 100%);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff;
  }
  .speaker {
    position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%);
    text-align: center; opacity: 0.30;
  }
  .speaker .ring {
    width: 190px; height: 190px; margin: 0 auto 22px; border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.45);
    background: radial-gradient(circle at 34% 30%, rgba(255,255,255,0.20), transparent 62%);
  }
  .speaker p { font-size: 21px; letter-spacing: 0.10em; margin: 0; text-transform: uppercase; }
  .chrome {
    position: absolute; left: 0; right: 0; bottom: 0; height: 52px;
    background: linear-gradient(to top, rgba(0,0,0,0.62), transparent);
  }
  .bar { position: absolute; left: 26px; right: 26px; bottom: 22px; height: 4px;
         border-radius: 2px; background: rgba(255,255,255,0.26); }
  .bar span { display: block; width: 43%; height: 100%; border-radius: 2px; background: #ff4d4f; }
  .feature-copy { position: absolute; left: 58px; top: 54px; max-width: 510px; }
  .feature-copy h1 { font-size: 36px; line-height: 1.16; margin: 0 0 12px; }
  .feature-copy p { color: #b7c7da; font-size: 17px; line-height: 1.55; margin: 0; max-width: 46ch; }
  .feature-copy i { background: #2dd4bf; border-radius: 2px; display: block; height: 4px; margin-bottom: 16px; width: 52px; }
</style>
<div class="player">
  <div class="feature-copy"><i></i><h1>${COPY.floatingHeading}</h1><p>${COPY.floatingBody}</p></div>
  <div class="speaker"><div class="ring"></div><p>Conference Talk</p></div>
  <div class="chrome"></div><div class="bar"><span></span></div>
</div>`;

// A web page cannot iframe a chrome-extension:// URL, so each panel is
// screenshotted on its own and inlined here as an image.
function browserShell({ body, heading, shot }) {
  return `<!doctype html>
<meta charset="utf-8">
<title>${heading.replace(/<[^>]+>/g, ' ')}</title>
<style>
  html, body { margin: 0; height: 100%;
    background: linear-gradient(150deg, #0f1a2b 0%, #0a0f1a 55%, #070a12 100%);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .wrap { display: flex; align-items: center; justify-content: center; gap: 60px;
          height: 100vh; padding: 0 76px; box-sizing: border-box; }
  .copy { max-width: 420px; color: #e8eef7; }
  .copy h1 { font-size: 40px; line-height: 1.22; margin: 0 0 18px; font-weight: 700; }
  .copy p { font-size: 19px; line-height: 1.65; margin: 0; color: #9fb2c9; }
  .copy .accent { color: #2dd4bf; }
  .frame { border-radius: 13px; overflow: hidden; flex: none;
           box-shadow: 0 26px 70px rgba(0,0,0,0.62); }
  .titlebar { display: flex; align-items: center; gap: 7px; height: 28px; padding: 0 13px;
              background: #182233; }
  .titlebar i { width: 11px; height: 11px; border-radius: 50%; display: block; }
  .frame img { display: block; max-height: 700px; width: auto; }
</style>
<div class="wrap">
  <div class="copy"><h1>${heading}</h1><p>${body}</p></div>
  <div class="frame">
    <div class="titlebar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
    <img src="data:image/png;base64,${shot}">
  </div>
</div>`;
}

async function shoot(page, path, clip) {
  await page.screenshot({ clip, path });
  console.log('wrote', path.replace(`${root}/`, ''));
}

const profile = mkdtempSync(join(tmpdir(), 'store-shots-'));
mkdirSync(outDir, { recursive: true });

const context = await chromium.launchPersistentContext(profile, {
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
  channel: 'chromium',
  viewport: SHOT,
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;

  const settings = async (patch) => {
    await worker.evaluate(async (next) => {
      const { settings: current = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...current, ...next } });
    }, patch);
  };

  // Screenshots one of the extension's own pages, cropped from the top of
  // `from` to the bottom of `to`, and returns it base64 for inlining into the
  // shell. Cropping rather than scaling the whole panel down: a store
  // screenshot nobody can read is worth nothing.
  const panelShot = async (page, from, to = from) => {
    const head = await page.locator(from).boundingBox();
    const tail = await page.locator(to).boundingBox();
    if (!head || !tail) throw new Error(`no element for ${from} / ${to}`);
    const top = Math.floor(head.y) - PANEL_PADDING;
    const buffer = await page.screenshot({
      clip: {
        height: Math.ceil(tail.y + tail.height) - top + PANEL_PADDING,
        width: Math.ceil(head.width + head.x * 2),
        x: 0,
        y: top,
      },
      // The Deepgram popup is taller than the viewport, and a clip is capped
      // at the viewport unless the whole page is captured.
      fullPage: true,
    });
    return buffer.toString('base64');
  };

  // 1. Captions over a player.
  const stage = await context.newPage();
  stage.on('pageerror', (error) => console.error('caption stage error', error));
  await stage.setViewportSize(SHOT);
  await stage.addInitScript((captionTitle) => {
    globalThis.chrome.i18n = {
      getMessage(key) {
        return key === 'captionOverlayTitle' ? captionTitle : key;
      },
    };
    globalThis.chrome.runtime = {
      id: 'store-screenshot',
      onMessage: {
        addListener(listener) {
          globalThis.__captionMessageListener = listener;
        },
      },
      sendMessage: async () => undefined,
    };
  }, LOCALE === 'zh_TW' ? '即時字幕' : 'Live captions');
  await stage.route('https://captions.example/**', (route) =>
    route.fulfill({ body: STAGE_PAGE, contentType: 'text/html' }),
  );
  await settings({ transcriber: 'gemini' });
  await stage.goto('https://captions.example/talk');
  await stage.addScriptTag({ path: join(extension, 'captions.js') });
  await stage.waitForFunction(() => typeof globalThis.__captionMessageListener === 'function');
  await stage.evaluate((pair) => {
    const send = (message) => globalThis.__captionMessageListener(
      message,
      { id: 'store-screenshot' },
      () => undefined,
    );
    send({
      type: 'OVERLAY_SHOW',
      payload: {
        appearance: {
          backgroundOpacity: 50,
          originalFontSize: 24,
          translationFontSize: 22,
        },
        layout: {
          floatingRect: {
            heightRatio: 0.25,
            widthRatio: 0.7,
            xRatio: 0.15,
            yRatio: 0.62,
          },
          mode: 'floating',
          version: 1,
        },
      },
    });
    send({
      type: 'CAPTION_WINDOW',
      payload: { pairs: [{ id: 'turn-0', ...pair }] },
    });
  }, SAMPLE);
  await stage.waitForTimeout(600);
  await stage.mouse.move(640, 485);
  await stage.waitForTimeout(250);
  await shoot(stage, join(outDir, 'screenshot-1-floating-resize.png'));
  await stage.close();

  // 2. The real Side Panel UI, fed a deterministic sample through its public
  // connection boundary so no live capture or API key is needed.
  const sidePage = await context.newPage();
  await sidePage.setViewportSize({ height: 700, width: 420 });
  await sidePage.addInitScript((snapshot) => {
    Object.defineProperty(chrome.runtime, 'connect', {
      configurable: true,
      value: () => ({
        disconnect() {},
        onDisconnect: { addListener() {} },
        onMessage: {
          addListener(listener) {
            queueMicrotask(() => listener({
              type: 'SIDE_PANEL_STATE',
              payload: snapshot,
            }));
          },
        },
      }),
    });
  }, {
    active: true,
    appearance: {
      backgroundOpacity: 50,
      originalFontSize: 24,
      originalTextColor: '#ffffff',
      translationFontSize: 22,
      translationTextColor: '#fde68a',
    },
    pairs: SIDEBAR_SAMPLE,
    status: { sessionId: 'store-screenshot', state: 'running', tabId: 1 },
  });
  await sidePage.goto(`chrome-extension://${id}/sidepanel.html`);
  await sidePage.locator('.caption-pair').first().waitFor();

  // 2-5. The extension's own pages, framed and captioned.
  const extPage = await context.newPage();
  await extPage.setViewportSize({ height: 1200, width: 420 });
  const panel = await context.newPage();
  await panel.setViewportSize(SHOT);

  const shell = async (file, { body, heading, shot }) => {
    await panel.route('https://shell.example/**', (route) =>
      route.fulfill({
        body: browserShell({ body, heading, shot }),
        contentType: 'text/html',
      }),
    );
    await panel.goto(`https://shell.example/${file}`);
    await panel.waitForTimeout(500);
    await shoot(panel, join(outDir, file));
    await panel.unrouteAll();
  };

  await shell('screenshot-2-sidebar.png', {
    body: COPY.sidebarBody,
    heading: COPY.sidebarHeading,
    shot: await panelShot(sidePage, '.side-panel-header', '.caption-history'),
  });
  await sidePage.close();

  await settings({ transcriber: 'gemini' });
  await extPage.goto(`chrome-extension://${id}/popup.html`);
  // Selected by id, not label: the labels change with the locale.
  await extPage.locator('#transcriber').waitFor();
  await shell('screenshot-3-popup-gemini.png', {
    body: COPY.popupGeminiBody,
    heading: COPY.popupGeminiHeading,
    // Header through the start button: the whole "set it up and go" flow.
    shot: await panelShot(extPage, '.header', 'button.primary'),
  });

  await shell('screenshot-4-caption-style.png', {
    body: COPY.popupDeepgramBody,
    heading: COPY.popupDeepgramHeading,
    shot: await panelShot(
      extPage,
      'section[aria-labelledby="size-heading"]',
      'section[aria-labelledby="layout-heading"]',
    ),
  });

  await extPage.goto(`chrome-extension://${id}/options.html`);
  await extPage.locator('#gemini-key').waitFor();
  await shell('screenshot-5-options.png', {
    body: COPY.optionsBody,
    heading: COPY.optionsHeading,
    shot: await panelShot(extPage, '.options'),
  });
  await extPage.close();

  // 5. Small promo tile.
  await panel.setViewportSize(PROMO);
  await panel.route('https://promo.example/**', (route) =>
    route.fulfill({
      body: `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; }
  .tile { display: flex; flex-direction: column; justify-content: center;
    height: 100vh; padding: 0 30px; box-sizing: border-box;
    background: radial-gradient(120% 130% at 8% 0%, #14304d 0%, #080d16 62%);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; }
  h1 { font-size: 27px; line-height: 1.24; margin: 0 0 12px; font-weight: 700; }
  .zh { color: #fde68a; font-size: 17px; font-weight: 600; margin: 0 0 16px; }
  p { color: #9fb2c9; font-size: 13.5px; line-height: 1.5; margin: 0; }
  .rule { width: 46px; height: 3px; background: #2dd4bf; border-radius: 2px; margin: 0 0 15px; }
</style>
<div class="tile">
  <div class="rule"></div>
  <h1>Bilingual Live Captions</h1>
  <p class="zh">雙語即時字幕翻譯</p>
  <p>Original and translation, live on any tab — with your own API key.</p>
</div>`,
      contentType: 'text/html',
    }),
  );
  await panel.goto('https://promo.example/tile');
  await panel.waitForTimeout(400);
  await shoot(panel, join(outDir, 'promo-small-440x280.png'));
} finally {
  await context.close();
  rmSync(profile, { force: true, recursive: true });
  rmSync(extension, { force: true, recursive: true });
}
