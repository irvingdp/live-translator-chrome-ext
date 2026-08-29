import type {
  PlayerControlRequest,
  PlayerControlResponse,
  PlayerControlState,
} from '../core/player-control';
import {
  findLargestVisiblePlayerFrame,
  findLargestVisibleVideo,
  visibleMediaArea,
} from './media-locator';

const HOST_ATTRIBUTE = 'data-bilingual-player-toggle';
const IDLE_HIDE_MS = 2500;

function controlLabel(element: Element): string {
  return [
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('data-uia'),
    element.getAttribute('data-testid'),
    element.className,
  ].filter((value): value is string => typeof value === 'string').join(' ').toLowerCase();
}

export function findPlayerToolbar(
  document: Document,
  media: Element,
): HTMLElement | undefined {
  const hostname = document.location.hostname;
  const siteSelector = hostname.includes('youtube.com')
    ? '.ytp-right-controls'
    : undefined;
  const siteToolbar = siteSelector
    ? document.querySelector<HTMLElement>(siteSelector)
    : undefined;
  if (siteToolbar) return siteToolbar;

  const controls = Array.from(
    document.querySelectorAll<HTMLElement>('button, [role="button"]'),
  );
  const fullscreen = controls.find((control) =>
    /(?:full.?screen|全螢幕|全屏)/i.test(controlLabel(control)),
  );
  if (!fullscreen) return undefined;

  // The fullscreen action conventionally lives in the right-hand control
  // section. Pick the nearest group with multiple controls, rather than the
  // common parent shared with Play on the left.
  let toolbar: HTMLElement | undefined;
  let current = fullscreen.parentElement;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const controlCount = current.querySelectorAll('button, [role="button"]').length;
    if (controlCount >= 2) {
      toolbar = current;
      break;
    }
    current = current.parentElement;
  }
  toolbar ??= fullscreen.parentElement ?? undefined;
  if (!toolbar || toolbar === document.body || toolbar === document.documentElement) {
    return undefined;
  }
  const mediaRect = media.getBoundingClientRect();
  const toolbarRect = toolbar.getBoundingClientRect();
  const nearBottom = toolbarRect.top >= mediaRect.top + mediaRect.height * 0.6;
  const overlaps = toolbarRect.right > mediaRect.left && toolbarRect.left < mediaRect.right;
  return nearBottom && overlaps ? toolbar : undefined;
}

function buttonStyles(button: HTMLButtonElement, integrated: boolean): void {
  Object.assign(button.style, {
    alignItems: 'center',
    appearance: 'none',
    background: 'transparent',
    border: '0',
    boxSizing: 'border-box',
    cursor: 'pointer',
    display: 'inline-flex',
    height: integrated ? '100%' : '40px',
    justifyContent: 'center',
    margin: '0',
    minHeight: integrated ? '36px' : '40px',
    minWidth: integrated ? '44px' : '40px',
    padding: integrated ? '0 10px' : '8px',
  });
}

export class PlayerToggleController {
  private candidate?: Element;
  private contextValid = true;
  private hideTimer?: number;
  private host?: HTMLElement;
  private guidance?: HTMLElement;
  private guidanceTimer?: number;
  private integrated = false;
  private observer?: MutationObserver;
  private port?: chrome.runtime.Port;
  private reconnectTimer?: number;
  private reportedArea = -1;
  private reportedKind?: 'iframe' | 'video';
  private resizeObserver?: ResizeObserver;
  private scanFrame?: number;
  private selected = false;
  private state: PlayerControlState = { active: false, busy: false };

  constructor(private readonly document: Document) {}

  start(): void {
    this.connect();
    this.observer = new MutationObserver(() => this.scheduleScan());
    this.observer.observe(this.document.documentElement, {
      childList: true,
      subtree: true,
    });
    this.document.defaultView?.addEventListener('resize', this.scheduleScan);
    this.document.defaultView?.addEventListener('scroll', this.scheduleScan, {
      passive: true,
    });
    this.document.addEventListener('fullscreenchange', this.scheduleScan);
    this.document.addEventListener('pointermove', this.handlePointerMove, true);
    this.scheduleScan();
  }

  stop(): void {
    this.contextValid = false;
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    try {
      this.port?.disconnect();
    } catch {
      // Reloading an unpacked extension invalidates the old content context.
    }
    this.removeControl();
    const view = this.document.defaultView;
    view?.removeEventListener('resize', this.scheduleScan);
    view?.removeEventListener('scroll', this.scheduleScan);
    this.document.removeEventListener('fullscreenchange', this.scheduleScan);
    this.document.removeEventListener('pointermove', this.handlePointerMove, true);
    if (this.scanFrame !== undefined) view?.cancelAnimationFrame(this.scanFrame);
    if (this.hideTimer !== undefined) view?.clearTimeout(this.hideTimer);
    if (this.reconnectTimer !== undefined) view?.clearTimeout(this.reconnectTimer);
    if (this.guidanceTimer !== undefined) view?.clearTimeout(this.guidanceTimer);
    this.guidance?.remove();
  }

  private readonly connect = () => {
    if (!this.contextValid) return;
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: 'player-toggle' });
    } catch {
      this.invalidateContext();
      return;
    }
    this.port = port;
    port.onMessage.addListener((message: PlayerControlResponse) => {
      if (message.type === 'PLAYER_SELECTION') {
        this.selected = message.payload.selected;
        this.state = message.payload.state;
        this.render();
      } else if (message.type === 'PLAYER_STATE') {
        this.state = message.payload;
        this.updateButton();
      } else if (message.type === 'PLAYER_TOGGLE_RESULT' && !message.payload.ok) {
        this.showGuidance(message.payload.error);
      }
    });
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      this.port = undefined;
      this.reconnectTimer = this.document.defaultView?.setTimeout(this.connect, 500);
    });
    this.reportCandidate(true);
  };

  private readonly scheduleScan = () => {
    if (!this.contextValid) return;
    const view = this.document.defaultView;
    if (!view || this.scanFrame !== undefined) return;
    this.scanFrame = view.requestAnimationFrame(() => {
      this.scanFrame = undefined;
      this.scan();
    });
  };

  private scan(): void {
    const next = findLargestVisibleVideo(this.document) ??
      findLargestVisiblePlayerFrame(this.document);
    if (next !== this.candidate) {
      this.resizeObserver?.disconnect();
      this.candidate = next;
      if (next && typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(this.scheduleScan);
        this.resizeObserver.observe(next);
      }
    }
    this.reportCandidate();
    this.render();
  }

  private reportCandidate(force = false): void {
    if (!this.port) return;
    const area = this.candidate
      ? visibleMediaArea(this.candidate, this.document)
      : 0;
    const kind = this.candidate instanceof HTMLVideoElement ? 'video' : 'iframe';
    if (
      !force &&
      area === this.reportedArea &&
      kind === this.reportedKind
    ) return;
    this.reportedArea = area;
    this.reportedKind = kind;
    const request: PlayerControlRequest = this.candidate
      ? {
          type: 'PLAYER_CANDIDATE',
          payload: {
            area,
            kind,
          },
        }
      : { type: 'PLAYER_CANDIDATE' };
    try {
      this.port.postMessage(request);
    } catch {
      this.invalidateContext();
    }
  }

  private render(): void {
    if (!this.selected || !this.candidate || !this.candidate.isConnected) {
      this.removeControl();
      return;
    }
    const toolbar = findPlayerToolbar(this.document, this.candidate);
    if (toolbar) this.renderIntegrated(toolbar);
    else this.renderFloating();
    this.updateButton();
  }

  private createButton(integrated: boolean): HTMLButtonElement {
    const button = this.document.createElement('button');
    button.type = 'button';
    button.dataset.bilingualCaptionToggle = 'true';
    buttonStyles(button, integrated);
    const image = this.document.createElement('img');
    image.alt = '';
    image.draggable = false;
    try {
      image.src = chrome.runtime.getURL('icon/32.png');
    } catch {
      this.invalidateContext();
    }
    Object.assign(image.style, {
      height: '28px',
      pointerEvents: 'none',
      transition: 'filter 140ms ease, opacity 140ms ease',
      width: '28px',
    });
    button.append(image);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!event.isTrusted || this.state.busy) return;
      try {
        this.port?.postMessage({ type: 'PLAYER_TOGGLE' } satisfies PlayerControlRequest);
      } catch {
        this.invalidateContext();
      }
    }, true);
    return button;
  }

  private renderIntegrated(toolbar: HTMLElement): void {
    if (this.host?.parentElement === toolbar && this.integrated) return;
    this.removeControl();
    const button = this.createButton(true);
    if (!this.contextValid) return;
    button.classList.add('ytp-button');
    button.setAttribute(HOST_ATTRIBUTE, 'integrated');
    toolbar.insertBefore(button, toolbar.firstChild);
    this.host = button;
    this.integrated = true;
  }

  private renderFloating(): void {
    if (!this.candidate) return;
    if (!this.host || this.integrated) {
      this.removeControl();
      const host = this.document.createElement('div');
      host.setAttribute(HOST_ATTRIBUTE, 'floating');
      const shadow = host.attachShadow({ mode: 'open' });
      const style = this.document.createElement('style');
      style.textContent = ':host{all:initial} button{border-radius:8px;background:rgba(0,0,0,.62)!important;box-shadow:0 1px 5px rgba(0,0,0,.45);transition:opacity 160ms ease,transform 160ms ease}button:hover,button:focus-visible{background:rgba(0,0,0,.82)!important;outline:2px solid #fff;outline-offset:1px}';
      const button = this.createButton(false);
      if (!this.contextValid) return;
      shadow.append(style, button);
      this.host = host;
      this.integrated = false;
    }
    const fullscreenParent = this.document.fullscreenElement;
    const parent = fullscreenParent instanceof HTMLElement
      ? fullscreenParent
      : this.document.documentElement;
    if (this.host.parentElement !== parent) parent.append(this.host);
    const rect = this.candidate.getBoundingClientRect();
    Object.assign(this.host.style, {
      display: rect.width >= 280 && rect.height >= 160 ? 'block' : 'none',
      left: `${Math.round(rect.left + 10)}px`,
      opacity: this.shouldStayVisible() ? '1' : '0',
      pointerEvents: this.shouldStayVisible() ? 'auto' : 'none',
      position: 'fixed',
      top: `${Math.round(rect.bottom - 50)}px`,
      zIndex: '2147483647',
    });
  }

  private button(): HTMLButtonElement | undefined {
    if (!this.host) return undefined;
    if (this.host instanceof HTMLButtonElement) return this.host;
    return this.host.shadowRoot?.querySelector('button') ?? undefined;
  }

  private updateButton(): void {
    const button = this.button();
    if (!button) return;
    const active = this.state.active || this.state.busy;
    button.disabled = this.state.busy;
    button.setAttribute('aria-pressed', String(this.state.active));
    button.setAttribute('aria-busy', String(this.state.busy));
    let label: string;
    try {
      label = chrome.i18n.getMessage(
        this.state.busy
          ? 'working'
          : this.state.active
            ? 'stopCaptions'
            : 'startCaptions',
      );
    } catch {
      this.invalidateContext();
      return;
    }
    button.setAttribute('aria-label', label);
    button.title = label;
    const image = button.querySelector('img');
    if (image) {
      image.style.filter = active
        ? 'brightness(1.18) saturate(1.2) drop-shadow(0 0 5px rgba(96,165,250,.95))'
        : 'brightness(.9) saturate(.78)';
      image.style.opacity = active ? '1' : '.86';
    }
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (this.integrated || !this.candidate) return;
    const rect = this.candidate.getBoundingClientRect();
    if (
      event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom
    ) return;
    if (this.host) {
      this.host.style.opacity = '1';
      this.host.style.pointerEvents = 'auto';
    }
    if (this.hideTimer !== undefined) {
      this.document.defaultView?.clearTimeout(this.hideTimer);
    }
    this.hideTimer = this.document.defaultView?.setTimeout(() => {
      if (this.shouldStayVisible() || !this.host) return;
      this.host.style.opacity = '0';
      this.host.style.pointerEvents = 'none';
    }, IDLE_HIDE_MS);
  };

  private shouldStayVisible(): boolean {
    return this.state.busy ||
      (this.candidate instanceof HTMLVideoElement && this.candidate.paused) ||
      this.button() === this.document.activeElement;
  }

  private showGuidance(error?: string): void {
    const button = this.button();
    if (!button) return;
    const key = error === 'missing_keys'
      ? 'playerToggleMissingKeys'
      : error === 'needs_toolbar_grant'
        ? 'playerToggleNeedsToolbarGrant'
        : 'playerToggleStartFailed';
    let message: string;
    try {
      message = chrome.i18n.getMessage(key);
    } catch {
      this.invalidateContext();
      return;
    }
    button.title = message;
    button.setAttribute('aria-label', message);
    this.guidance?.remove();
    const guidance = this.document.createElement('div');
    guidance.dataset.bilingualPlayerGuidance = 'true';
    guidance.textContent = message;
    const mediaRect = this.candidate?.getBoundingClientRect();
    Object.assign(guidance.style, {
      background: 'rgba(3,7,18,.94)',
      border: '1px solid rgba(255,255,255,.28)',
      borderRadius: '8px',
      boxShadow: '0 4px 18px rgba(0,0,0,.45)',
      color: '#fff',
      font: '600 14px/1.4 system-ui, sans-serif',
      left: `${Math.max(12, Math.round((mediaRect?.left ?? 0) + 12))}px`,
      maxWidth: '320px',
      padding: '10px 12px',
      pointerEvents: 'none',
      position: 'fixed',
      top: `${Math.max(12, Math.round((mediaRect?.bottom ?? 140) - 112))}px`,
      zIndex: '2147483647',
    });
    const parent = this.document.fullscreenElement instanceof HTMLElement
      ? this.document.fullscreenElement
      : this.document.documentElement;
    parent.append(guidance);
    this.guidance = guidance;
    if (this.guidanceTimer !== undefined) {
      this.document.defaultView?.clearTimeout(this.guidanceTimer);
    }
    this.guidanceTimer = this.document.defaultView?.setTimeout(() => {
      guidance.remove();
      if (this.guidance === guidance) this.guidance = undefined;
    }, 6000);
  }

  private removeControl(): void {
    this.host?.remove();
    this.host = undefined;
    this.integrated = false;
  }

  private invalidateContext(): void {
    if (!this.contextValid) return;
    this.contextValid = false;
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    const view = this.document.defaultView;
    view?.removeEventListener('resize', this.scheduleScan);
    view?.removeEventListener('scroll', this.scheduleScan);
    this.document.removeEventListener('fullscreenchange', this.scheduleScan);
    this.document.removeEventListener('pointermove', this.handlePointerMove, true);
    if (this.scanFrame !== undefined) view?.cancelAnimationFrame(this.scanFrame);
    if (this.hideTimer !== undefined) view?.clearTimeout(this.hideTimer);
    if (this.reconnectTimer !== undefined) view?.clearTimeout(this.reconnectTimer);
    if (this.guidanceTimer !== undefined) view?.clearTimeout(this.guidanceTimer);
    this.port = undefined;
    this.guidance?.remove();
    this.removeControl();
  }
}
