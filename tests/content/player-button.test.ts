import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  findPlayerControls,
  PlayerButton,
  PLAYER_BUTTON_ATTRIBUTE,
  type PlayerButtonApi,
} from '../../src/content/player-button';

function youtubePlayer(): void {
  document.body.innerHTML = `
    <div id="movie_player">
      <div class="ytp-right-controls">
        <div class="other-extension"></div>
        <div class="ytp-right-controls-left"><button class="ytp-settings-button"></button></div>
        <div class="ytp-right-controls-right"></div>
      </div>
    </div>`;
}

function bilibiliPlayer(): void {
  document.body.innerHTML = `
    <div class="bpx-player-container">
      <div class="bpx-player-control-bottom-right">
        <div class="bpx-player-ctrl-btn bpx-player-ctrl-full"></div>
      </div>
    </div>`;
}

function fakeApi(overrides: Partial<PlayerButtonApi> = {}) {
  let activeListener: ((active: boolean) => void) | undefined;
  const api: PlayerButtonApi = {
    iconUrl: () => 'chrome-extension://id/icon/32.png',
    openSettings: vi.fn().mockResolvedValue(undefined),
    setTargetLanguage: vi.fn().mockResolvedValue(undefined),
    state: vi.fn().mockResolvedValue({ active: false, mode: 'read-ahead', targetLanguage: 'zh-Hant' }),
    toggle: vi.fn().mockResolvedValue({ active: true }),
    onActiveChange: (listener) => { activeListener = listener; },
    ...overrides,
  };
  return { api, setActive: (active: boolean) => activeListener?.(active) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const button = () => document.querySelector<HTMLButtonElement>(`[${PLAYER_BUTTON_ATTRIBUTE}]`)!;
const menu = () => document.querySelector<HTMLElement>('[data-bilingual-player-menu]')?.shadowRoot;

let current: PlayerButton | undefined;
function start(api: PlayerButtonApi): PlayerButton {
  current = new PlayerButton(document, api);
  current.start();
  return current;
}

afterEach(() => {
  current?.stop();
  current = undefined;
  document.body.innerHTML = '';
});

describe('player button', () => {
  it("goes in YouTube's own controls, before its buttons and after another extension's", () => {
    youtubePlayer();
    start(fakeApi().api);
    const toolbar = document.querySelector('.ytp-right-controls')!;
    expect([...toolbar.children].map((child) => child.className))
      .toEqual(['other-extension', 'ytp-button', 'ytp-right-controls-left', 'ytp-right-controls-right']);
    expect(button()).toHaveAttribute(PLAYER_BUTTON_ATTRIBUTE, 'youtube');
    expect(button()).toHaveAttribute('aria-label', '雙語字幕');
    expect(button().querySelector('img')).toHaveAttribute('src', 'chrome-extension://id/icon/32.png');
  });

  it("goes first in Bilibili's right-hand controls", () => {
    bilibiliPlayer();
    start(fakeApi().api);
    expect(button()).toHaveAttribute(PLAYER_BUTTON_ATTRIBUTE, 'bilibili');
    expect(document.querySelector('.bpx-player-control-bottom-right')!.firstElementChild).toBe(button());
  });

  it('finds no controls on a page without a known player', () => {
    document.body.innerHTML = '<video></video>';
    expect(findPlayerControls(document)).toBeUndefined();
  });

  it('comes back when the player rebuilds its controls', () => {
    youtubePlayer();
    const playerButton = start(fakeApi().api);
    youtubePlayer();
    expect(button()).toBeNull();
    playerButton.scan();
    expect(button()).not.toBeNull();
    expect(document.querySelectorAll(`[${PLAYER_BUTTON_ATTRIBUTE}]`)).toHaveLength(1);
  });

  it('opens a menu in the player: captions switch, target language, more settings', async () => {
    youtubePlayer();
    const { api } = fakeApi();
    start(api);
    button().click();
    await settle();

    // Beside the caption overlay, not inside the player, so it is above the captions box.
    expect(document.querySelector('[data-bilingual-player-menu]')!.parentElement).toBe(document.body);
    expect(document.querySelector<HTMLElement>('[data-bilingual-player-menu]')!.style.position).toBe('fixed');
    expect(button()).toHaveAttribute('aria-expanded', 'true');
    const toggle = menu()!.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(menu()!.textContent).toContain('開啟字幕');
    expect(menu()!.textContent).toContain('預讀模式');
    expect(menu()!.querySelector('select')).toHaveValue('zh-Hant');
    expect(menu()!.textContent).toContain('更多設定');

    // Clicking outside closes it.
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(menu()).toBeUndefined();
    expect(button()).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts captions from the switch and lights the button', async () => {
    youtubePlayer();
    const { api } = fakeApi();
    start(api);
    button().click();
    await settle();
    menu()!.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    await settle();
    expect(api.toggle).toHaveBeenCalledWith(true);
    expect(menu()!.querySelector('[role="switch"]')).toHaveAttribute('aria-checked', 'true');
    expect(button()).toHaveAttribute('aria-label', '雙語字幕（字幕開啟中）');
    expect(button().dataset.active).toBe('true');
  });

  it('names the mode chosen in the popup under the switch', async () => {
    youtubePlayer();
    start(fakeApi({
      state: vi.fn().mockResolvedValue({ active: false, mode: 'live', targetLanguage: 'en' }),
    }).api);
    button().click();
    await settle();
    expect(menu()!.querySelector('.note')).toHaveTextContent('即時音訊模式');
    expect(menu()!.querySelector('select')).toHaveValue('en');
  });

  it('says what is missing when captions cannot start', async () => {
    youtubePlayer();
    const { api } = fakeApi({ toggle: vi.fn().mockResolvedValue({ active: false, error: 'missing_keys' }) });
    start(api);
    button().click();
    await settle();
    menu()!.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    await settle();
    const message = menu()!.querySelector<HTMLElement>('.message')!;
    expect(message.hidden).toBe(false);
    expect(message).toHaveTextContent('請先在「更多設定」填入 API Key。');
    expect(menu()!.querySelector('[role="switch"]')).toHaveAttribute('aria-checked', 'false');
  });

  it('changes the target language and opens the settings', async () => {
    youtubePlayer();
    const { api } = fakeApi();
    start(api);
    button().click();
    await settle();
    const select = menu()!.querySelector('select')!;
    select.value = 'ja';
    select.dispatchEvent(new Event('change'));
    expect(api.setTargetLanguage).toHaveBeenCalledWith('ja');

    menu()!.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();
    expect(api.openSettings).toHaveBeenCalledOnce();
    expect(menu()).toBeUndefined();
  });

  it('sits after a caption overlay mounted before it, and closes when the page scrolls', async () => {
    youtubePlayer();
    const overlay = document.createElement('div');
    overlay.dataset.bilingualCaptionRoot = '';
    document.body.append(overlay);
    start(fakeApi().api);
    button().click();
    await settle();
    expect(overlay.nextElementSibling).toHaveAttribute('data-bilingual-player-menu');
    // An overlay that mounts later (captions started from the menu) goes under it too.
    const later = document.createElement('div');
    document.body.append(later);
    current!.scan();
    expect(later.nextElementSibling).toHaveAttribute('data-bilingual-player-menu');
    document.dispatchEvent(new Event('scroll'));
    expect(menu()).toBeUndefined();
  });

  it("keeps the menu's keys and clicks from reaching the page", async () => {
    youtubePlayer();
    start(fakeApi().api);
    const player = document.body;
    const heard = vi.fn();
    player.addEventListener('keydown', heard);
    player.addEventListener('click', heard);
    button().click();
    await settle();
    const host = document.querySelector('[data-bilingual-player-menu]')!;
    host.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }));
    host.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(heard).not.toHaveBeenCalled();
  });

  it('follows captions started or stopped elsewhere', () => {
    youtubePlayer();
    const { api, setActive } = fakeApi();
    start(api);
    setActive(true);
    expect(button().dataset.active).toBe('true');
    setActive(false);
    expect(button().dataset.active).toBe('false');
  });
});
