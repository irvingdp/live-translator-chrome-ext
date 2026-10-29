import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const builtExtension = resolve('output/chrome-mv3');
const VIDEO_PAGE = '<!doctype html><title>Video</title><video src="" controls></video>';

let context: BrowserContext;
let worker: Worker;
let extensionPage: Page;
let profile: string;
let extensionPath: string;

// A real click on the toolbar icon grants activeTab; chrome.action.openPopup()
// from a test does not, so the copy under test is given the fake video site's
// host permission instead. The shipped manifest is untouched.
function extensionCopy(): string {
  const copy = mkdtempSync(join(tmpdir(), 'blc-ext-'));
  cpSync(builtExtension, copy, { recursive: true });
  const manifestPath = join(copy, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = [...(manifest.host_permissions ?? []), 'https://video.example/*'];
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return copy;
}

test.beforeEach(async () => {
  profile = mkdtempSync(join(tmpdir(), 'blc-e2e-'));
  extensionPath = extensionCopy();
  context = await chromium.launchPersistentContext(profile, {
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    channel: 'chromium',
    headless: true,
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  await context.route('https://video.example/**', (route) =>
    route.fulfill({ body: VIDEO_PAGE, contentType: 'text/html' }),
  );
  // Playwright does not expose the action popup as a page, but any extension
  // page can reach its DOM through chrome.extension.getViews.
  extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${id}/options.html`);
});

test.afterEach(async () => {
  await context.close();
  rmSync(profile, { force: true, recursive: true });
  rmSync(extensionPath, { force: true, recursive: true });
});

async function openPopupOn(url: string) {
  const page = await context.newPage();
  await page.goto(url);
  await page.bringToFront();
  await worker.evaluate(() => chrome.action.openPopup());
}

// Waits for the popup to finish loading, then reports what it shows.
async function popupState() {
  await expect
    .poll(() =>
      extensionPage.evaluate(() => {
        const [popup] = chrome.extension.getViews({ type: 'popup' });
        return Boolean(popup?.document.querySelector('.popup-footer'));
      }),
    )
    .toBe(true);
  return extensionPage.evaluate(() => {
    const [popup] = chrome.extension.getViews({ type: 'popup' });
    const card = popup!.document.querySelector('.rating-card');
    return {
      title: card?.querySelector('h2')?.textContent ?? null,
      stars: card?.querySelectorAll('.rating-star').length ?? 0,
      website: popup!.document.querySelector<HTMLAnchorElement>('.popup-footer a')?.href,
    };
  });
}

test('asks for a rating in the popup of the second authorized tab', async () => {
  // As if captions already ran once on another tab.
  await worker.evaluate(() =>
    chrome.storage.local.set({
      ratingPrompt: { recentTabIds: [987654], started: true, status: 'pending', tabCount: 1 },
    }),
  );

  await openPopupOn('https://video.example/second');

  await expect.poll(async () => (await popupState()).title).toMatch(/Enjoying .+\?|好用嗎？/);
  expect((await popupState()).stars).toBe(5);
  const stored = await worker.evaluate(() => chrome.storage.local.get('ratingPrompt'));
  expect(stored.ratingPrompt).toMatchObject({ tabCount: 2 });
});

test('hovering each star in the real popup lights the stars up to it', async () => {
  await worker.evaluate(() =>
    chrome.storage.local.set({
      ratingPrompt: { recentTabIds: [987654], started: true, status: 'pending', tabCount: 1 },
    }),
  );
  await openPopupOn('https://video.example/second');
  await expect.poll(async () => (await popupState()).stars).toBe(5);

  for (const n of [1, 2, 3, 4, 5]) {
    const lit = await extensionPage.evaluate((index) => {
      const [popup] = chrome.extension.getViews({ type: 'popup' });
      const stars = [...popup!.document.querySelectorAll('.rating-star')];
      stars[index]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      return new Promise<boolean[]>((done) =>
        requestAnimationFrame(() => done(stars.map((star) => star.classList.contains('filled')))),
      );
    }, n - 1);
    expect(lit, `hovering star ${n}`).toEqual([1, 2, 3, 4, 5].map((i) => i <= n));
  }
});

test('does not ask before captions have ever started', async () => {
  await openPopupOn('https://video.example/first');

  const state = await popupState();
  expect(state.title).toBeNull();
  expect(state.website).toMatch(/^https:\/\/irvingdp\.github\.io\/live-translator-chrome-ext\//);
});
