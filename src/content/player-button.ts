// The player button (GLOSSARY.md, ADR 0013): an icon in YouTube's and
// Bilibili's own player controls that opens a small menu to turn captions on
// and off in the mode chosen in the popup, pick the language they are
// translated into, or open the rest of the settings.
import { GEMINI_LANGUAGE_OPTIONS } from '../core/gemini-languages';
import { t, type MessageKey } from '../core/i18n';

export const PLAYER_BUTTON_ATTRIBUTE = 'data-bilingual-player-button';

export type PlayerButtonError =
  | 'missing_keys'
  | 'model_missing'
  | 'needs_permission'
  | 'needs_toolbar_grant'
  | 'start_failed';

export interface PlayerButtonState {
  active: boolean;
  // The caption mode chosen in the popup, which the switch starts.
  mode: 'live' | 'read-ahead';
  targetLanguage: string;
}

export interface PlayerButtonApi {
  iconUrl(): string;
  // Whether captions run in this tab, and the language they translate into.
  state(): Promise<PlayerButtonState>;
  // Starts captions in this tab in the chosen mode, or stops them here.
  toggle(on: boolean): Promise<{ active: boolean; error?: PlayerButtonError }>;
  setTargetLanguage(targetLanguage: string): Promise<void>;
  openSettings(): Promise<void>;
  // The background's word that captions started or stopped in this tab.
  onActiveChange(listener: (active: boolean) => void): void;
}

const ERROR_MESSAGES: Record<PlayerButtonError, MessageKey> = {
  missing_keys: 'playerButtonMissingKeys',
  model_missing: 'playerButtonModelMissing',
  needs_permission: 'playerButtonNeedsPermission',
  needs_toolbar_grant: 'playerButtonNeedsToolbarGrant',
  start_failed: 'playerButtonStartFailed',
};

interface PlayerControls {
  // Where the button goes, and what it goes before.
  before: Element | null;
  player: HTMLElement;
  site: 'bilibili' | 'youtube';
  toolbar: HTMLElement;
}

export function findPlayerControls(document: Document): PlayerControls | undefined {
  const youtube = document.querySelector<HTMLElement>('#movie_player .ytp-right-controls');
  const youtubePlayer = youtube?.closest<HTMLElement>('#movie_player');
  if (youtube && youtubePlayer) {
    return {
      before: youtube.querySelector(':scope > .ytp-right-controls-left') ?? youtube.firstElementChild,
      player: youtubePlayer,
      site: 'youtube',
      toolbar: youtube,
    };
  }
  const bilibili = document.querySelector<HTMLElement>('.bpx-player-control-bottom-right');
  const bilibiliPlayer = bilibili?.closest<HTMLElement>('.bpx-player-container');
  if (bilibili && bilibiliPlayer) {
    return { before: bilibili.firstElementChild, player: bilibiliPlayer, site: 'bilibili', toolbar: bilibili };
  }
  return undefined;
}

const MENU_CSS = `
  :host { all: initial; }
  .menu {
    background: rgba(28, 28, 28, 0.9);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 14px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    box-sizing: border-box;
    color: #f1f5f9;
    font: 500 14px/1.4 system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
    padding: 6px;
    width: 280px;
  }
  .row { align-items: center; border-radius: 9px; box-sizing: border-box; display: flex; gap: 12px; min-height: 48px; padding: 8px 10px; width: 100%; }
  .row:hover { background: rgba(255, 255, 255, 0.08); }
  .row svg { flex: none; fill: none; height: 20px; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; width: 20px; }
  .label { flex: 1; min-width: 0; text-align: left; }
  .note { color: rgba(241, 245, 249, 0.6); display: block; font-size: 12px; }
  button.row { background: none; border: 0; color: inherit; cursor: pointer; font: inherit; }
  .switch { background: rgba(255, 255, 255, 0.28); border: 0; border-radius: 999px; cursor: pointer; flex: none; height: 22px; padding: 0; position: relative; transition: background 140ms; width: 40px; }
  .switch::after { background: #fff; border-radius: 50%; content: ""; height: 18px; left: 2px; position: absolute; top: 2px; transition: transform 140ms; width: 18px; }
  .switch[aria-checked="true"] { background: #14b8a6; }
  .switch[aria-checked="true"]::after { transform: translateX(18px); }
  .switch:disabled { cursor: default; opacity: 0.6; }
  select { background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 7px; color: #f1f5f9; font: inherit; font-size: 13px; max-width: 130px; padding: 4px 6px; }
  select option { color: #111827; }
  .message { background: rgba(251, 191, 36, 0.14); border-radius: 9px; color: #fde68a; font-size: 13px; margin: 2px 4px 6px; padding: 8px 10px; }
  .message[hidden] { display: none; }
  .chevron { opacity: 0.6; }
  :focus-visible { outline: 2px solid #5eead4; outline-offset: 1px; }
`;

function icon(document: Document, paths: string[]): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const CAPTIONS_ICON = ['M4 6h16v12H4z', 'M7 11h4M13 11h4M7 14h6M15 14h2'];
const LANGUAGE_ICON = ['M4 5h8M8 3v2M10 5c0 4-3 7-6 8M6 9c1 2 3 3.5 5 4', 'M13 21l4-9 4 9M14.5 18h5'];
const SETTINGS_ICON = [
  'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
];

export class PlayerButton {
  private active = false;
  private button?: HTMLButtonElement;
  private controls?: PlayerControls;
  private menuHost?: HTMLElement;
  private observer?: MutationObserver;
  private scanFrame?: number;
  private stopped = false;
  private mode: PlayerButtonState['mode'] = 'live';
  private targetLanguage = '';

  constructor(
    private readonly document: Document,
    private readonly api: PlayerButtonApi,
  ) {}

  start(): void {
    this.api.onActiveChange((active) => {
      this.active = active;
      this.render();
    });
    // The player is built, and rebuilt on every video change, after the
    // page loads: the button goes back in whenever it is missing.
    this.observer = new MutationObserver(() => this.scheduleScan());
    this.observer.observe(this.document.documentElement, { childList: true, subtree: true });
    this.document.addEventListener('pointerdown', this.closeOnOutside, true);
    this.document.addEventListener('keydown', this.closeOnEscape, true);
    // The menu is placed in the viewport: it closes rather than drift.
    this.document.defaultView?.addEventListener('resize', this.closeOnMove);
    this.document.addEventListener('scroll', this.closeOnMove, true);
    this.document.addEventListener('fullscreenchange', this.closeOnMove);
    this.scan();
    void this.refresh();
  }

  stop(): void {
    this.stopped = true;
    this.observer?.disconnect();
    this.document.removeEventListener('pointerdown', this.closeOnOutside, true);
    this.document.removeEventListener('keydown', this.closeOnEscape, true);
    this.document.defaultView?.removeEventListener('resize', this.closeOnMove);
    this.document.removeEventListener('scroll', this.closeOnMove, true);
    this.document.removeEventListener('fullscreenchange', this.closeOnMove);
    if (this.scanFrame !== undefined) this.document.defaultView?.cancelAnimationFrame(this.scanFrame);
    this.closeMenu();
    this.button?.remove();
    this.button = undefined;
  }

  private scheduleScan(): void {
    const view = this.document.defaultView;
    if (this.stopped || !view || this.scanFrame !== undefined) return;
    this.scanFrame = view.requestAnimationFrame(() => {
      this.scanFrame = undefined;
      this.scan();
    });
  }

  scan(): void {
    if (this.stopped) return;
    // The caption overlay appeared after the menu (captions just started
    // from it): the menu goes back on top.
    if (this.menuHost?.nextElementSibling) this.overlayParent().append(this.menuHost);
    const controls = findPlayerControls(this.document);
    this.controls = controls;
    if (!controls) return;
    if (this.button?.parentElement === controls.toolbar) return;
    this.button?.remove();
    this.button = this.createButton(controls);
    controls.toolbar.insertBefore(this.button, controls.before);
    this.render();
  }

  private createButton(controls: PlayerControls): HTMLButtonElement {
    const button = this.document.createElement('button');
    button.type = 'button';
    button.setAttribute(PLAYER_BUTTON_ATTRIBUTE, controls.site);
    if (controls.site === 'youtube') button.className = 'ytp-button';
    else button.className = 'bpx-player-ctrl-btn';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    Object.assign(button.style, {
      alignItems: 'center',
      background: 'none',
      border: '0',
      cursor: 'pointer',
      display: 'inline-flex',
      height: controls.site === 'youtube' ? '100%' : '22px',
      justifyContent: 'center',
      padding: '0',
      width: controls.site === 'youtube' ? '48px' : '36px',
    });
    const image = this.document.createElement('img');
    image.alt = '';
    image.draggable = false;
    image.src = this.api.iconUrl();
    Object.assign(image.style, {
      borderRadius: '6px',
      height: controls.site === 'youtube' ? '26px' : '22px',
      pointerEvents: 'none',
      transition: 'filter 140ms ease, opacity 140ms ease',
      width: controls.site === 'youtube' ? '26px' : '22px',
    });
    button.append(image);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.menuHost) this.closeMenu();
      else void this.openMenu();
    });
    return button;
  }

  private render(): void {
    const button = this.button;
    if (!button) return;
    const label = t(this.active ? 'playerButtonActive' : 'playerButtonLabel');
    button.setAttribute('aria-label', label);
    button.title = label;
    button.dataset.active = String(this.active);
    const image = button.querySelector('img');
    if (image) {
      image.style.filter = this.active
        ? 'drop-shadow(0 0 4px rgba(94, 234, 212, 0.9))'
        : 'saturate(0.75)';
      image.style.opacity = this.active ? '1' : '0.85';
    }
    const toggle = this.menuHost?.shadowRoot?.querySelector<HTMLButtonElement>('.switch');
    toggle?.setAttribute('aria-checked', String(this.active));
  }

  private async refresh(): Promise<void> {
    try {
      const state = await this.api.state();
      this.active = state.active;
      this.mode = state.mode;
      this.targetLanguage = state.targetLanguage;
    } catch {
      return;
    }
    this.render();
    const select = this.menuHost?.shadowRoot?.querySelector('select');
    if (select) select.value = this.targetLanguage;
    const note = this.menuHost?.shadowRoot?.querySelector('.note');
    if (note) note.textContent = this.modeLabel();
  }

  private async openMenu(): Promise<void> {
    const controls = this.controls;
    const button = this.button;
    if (!controls || !button) return;
    const host = this.document.createElement('div');
    host.dataset.bilingualPlayerMenu = '';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = this.document.createElement('style');
    style.textContent = MENU_CSS;
    const menu = this.document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');

    const message = this.document.createElement('div');
    message.className = 'message';
    message.hidden = true;
    message.setAttribute('role', 'status');

    // Turn captions on or off.
    const captionsRow = this.document.createElement('div');
    captionsRow.className = 'row';
    const captionsLabel = this.document.createElement('span');
    captionsLabel.className = 'label';
    captionsLabel.id = 'player-captions-label';
    captionsLabel.textContent = t('playerButtonCaptions');
    const captionsNote = this.document.createElement('span');
    captionsNote.className = 'note';
    captionsNote.textContent = this.modeLabel();
    captionsLabel.append(captionsNote);
    const toggle = this.document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'switch';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(this.active));
    toggle.setAttribute('aria-labelledby', captionsLabel.id);
    toggle.addEventListener('click', () => {
      const on = !this.active;
      toggle.disabled = true;
      message.hidden = true;
      void this.api.toggle(on).then(
        (result) => {
          this.active = result.active;
          if (result.error) {
            message.textContent = t(ERROR_MESSAGES[result.error]);
            message.hidden = false;
          }
        },
        () => {
          message.textContent = t('playerButtonStartFailed');
          message.hidden = false;
        },
      ).finally(() => {
        toggle.disabled = false;
        this.render();
      });
    });
    captionsRow.append(icon(this.document, CAPTIONS_ICON), captionsLabel, toggle);

    // The language captions are translated into.
    const languageRow = this.document.createElement('label');
    languageRow.className = 'row';
    const languageLabel = this.document.createElement('span');
    languageLabel.className = 'label';
    languageLabel.textContent = t('playerButtonLanguage');
    const select = this.document.createElement('select');
    for (const option of GEMINI_LANGUAGE_OPTIONS) {
      const element = this.document.createElement('option');
      element.value = option.code;
      element.textContent = option.label;
      select.append(element);
    }
    select.value = this.targetLanguage;
    select.addEventListener('change', () => {
      this.targetLanguage = select.value;
      void this.api.setTargetLanguage(select.value).catch(() => undefined);
    });
    languageRow.append(icon(this.document, LANGUAGE_ICON), languageLabel, select);

    // Everything else lives in the popup.
    const settingsRow = this.document.createElement('button');
    settingsRow.type = 'button';
    settingsRow.className = 'row';
    settingsRow.setAttribute('role', 'menuitem');
    const settingsLabel = this.document.createElement('span');
    settingsLabel.className = 'label';
    settingsLabel.textContent = t('playerButtonMoreSettings');
    const chevron = this.document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = '›';
    chevron.setAttribute('aria-hidden', 'true');
    settingsRow.append(icon(this.document, SETTINGS_ICON), settingsLabel, chevron);
    settingsRow.addEventListener('click', () => {
      this.closeMenu();
      void this.api.openSettings().catch(() => undefined);
    });

    menu.append(message, captionsRow, languageRow, settingsRow);
    shadow.append(style, menu);
    // Keys and clicks in the menu are the menu's, not the player's (Space
    // would pause it, a number key seek).
    for (const type of ['click', 'keydown', 'keyup', 'pointerdown', 'mousedown', 'dblclick', 'wheel']) {
      host.addEventListener(type, (event) => event.stopPropagation());
    }

    // Beside the caption overlay, where it mounts too (the page, or the
    // fullscreen element), and after it: at the same z-index the later one
    // is on top. Inside the player it would sit under the captions box.
    const view = this.document.defaultView;
    const buttonRect = button.getBoundingClientRect();
    Object.assign(host.style, {
      bottom: `${Math.max(8, (view?.innerHeight ?? 0) - buttonRect.top + 8)}px`,
      position: 'fixed',
      right: `${Math.max(8, (view?.innerWidth ?? 0) - buttonRect.right)}px`,
      zIndex: '2147483647',
    });
    this.overlayParent().append(host);
    this.menuHost = host;
    button.setAttribute('aria-expanded', 'true');
    await this.refresh();
  }

  // Where the caption overlay mounts (caption-overlay.ts position()).
  private overlayParent(): HTMLElement {
    const fullscreen = this.document.fullscreenElement;
    if (
      fullscreen instanceof HTMLElement &&
      fullscreen !== this.document.documentElement &&
      !(fullscreen instanceof HTMLVideoElement) &&
      !(fullscreen instanceof HTMLIFrameElement)
    ) {
      return fullscreen;
    }
    return this.document.body ?? this.document.documentElement;
  }

  private modeLabel(): string {
    return t(this.mode === 'read-ahead' ? 'transcriberReadAhead' : 'transcriberLive');
  }

  private closeMenu(): void {
    this.menuHost?.remove();
    this.menuHost = undefined;
    this.button?.setAttribute('aria-expanded', 'false');
  }

  private readonly closeOnOutside = (event: Event) => {
    if (!this.menuHost) return;
    const path = event.composedPath();
    if (path.includes(this.menuHost) || (this.button && path.includes(this.button))) return;
    this.closeMenu();
  };

  private readonly closeOnMove = () => this.closeMenu();

  private readonly closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.menuHost) this.closeMenu();
  };
}
