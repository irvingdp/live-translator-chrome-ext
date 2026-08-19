import type { CaptionPair } from '../core/caption-window';
import { t, type MessageKey } from '../core/i18n';
import {
  normalizeOverlayLayout,
  type FloatingRect,
  type OverlayLayout,
} from '../core/overlay-layout';
import type { CaptionAppearance } from '../core/settings';

const SESSION_ERROR_KEYS: Record<string, MessageKey> = {
  deepgram_disconnected: 'errorDeepgramDisconnected',
  gemini_disconnected: 'errorGeminiDisconnected',
  gemini_invalid_credentials: 'errorGeminiInvalidCredentials',
  gemini_quota_exceeded: 'errorGeminiQuotaExceeded',
  gemini_unavailable: 'errorGeminiUnavailable',
  invalid_credentials: 'errorInvalidCredentials',
  invalid_response: 'errorInvalidResponse',
  provider_unavailable: 'errorProviderUnavailable',
  quota_exceeded: 'errorQuotaExceeded',
  rate_limited: 'errorRateLimited',
  translation_disabled: 'errorTranslationDisabled',
  translation_failed: 'errorTranslationFailed',
};

const VIEWPORT_MARGIN = 8;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 120;

function videoCandidates(document: Document): HTMLVideoElement[] {
  const hostname = document.location.hostname;
  const selector = hostname.includes('youtube.com')
    ? 'video.html5-main-video'
    : hostname.includes('netflix.com')
      ? 'video'
      : hostname.includes('disneyplus.com')
        ? '[data-testid="video-player"] video, video'
        : 'video';
  return Array.from(document.querySelectorAll<HTMLVideoElement>(selector));
}

export function findLargestVisibleVideo(
  document: Document,
): HTMLVideoElement | undefined {
  return videoCandidates(document)
    .map((video) => ({ video, rect: video.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
    .sort(
      (left, right) =>
        right.rect.width * right.rect.height -
        left.rect.width * left.rect.height,
    )[0]?.video;
}

const OVERLAY_CSS = `
  :host { all: initial; }
  .stage { box-sizing: border-box; height: 100%; pointer-events: none; position: relative; width: 100%; }
  .captions {
    background: rgba(3, 7, 18, var(--caption-bg-opacity, 0.78));
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.34);
    box-sizing: border-box;
    color: #fff;
    cursor: grab;
    display: flex;
    flex-direction: column;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.35;
    overflow: hidden;
    padding: 12px 14px 10px;
    pointer-events: auto;
    position: absolute;
    text-align: center;
    touch-action: none;
    user-select: none;
  }
  .captions.dragging { cursor: grabbing; }
  .viewport { display: flex; flex: 1; flex-direction: column; justify-content: flex-end; min-height: 0; overflow: hidden; pointer-events: none; }
  .track { display: flex; flex-direction: column; justify-content: flex-end; }
  .pair { padding: 2px 0; }
  .pair[data-hidden="true"] { display: none; }
  .original { font-size: var(--caption-original-size, 24px); font-weight: 650; overflow-wrap: break-word; text-shadow: 0 1px 2px #000; }
  .translation { color: #fde68a; font-size: var(--caption-translation-size, 22px); font-weight: 550; margin-top: 3px; overflow-wrap: break-word; text-shadow: 0 1px 2px #000; }
  .status-message { color: #fca5a5; flex: 0 0 auto; font-size: 16px; font-weight: 600; margin-top: 5px; overflow-wrap: anywhere; pointer-events: none; text-shadow: 0 1px 2px #000; }
  .original:empty, .translation:empty, .status-message:empty { display: none; }
  .side-panel-button {
    align-items: center;
    background: rgba(15, 23, 42, 0.82);
    border: 1px solid rgba(255, 255, 255, 0.24);
    border-radius: 7px;
    color: #99f6e4;
    cursor: pointer;
    display: flex;
    font: 700 15px/1 system-ui, sans-serif;
    height: 30px;
    justify-content: center;
    opacity: 0.72;
    padding: 0;
    pointer-events: auto;
    position: absolute;
    right: 7px;
    top: 7px;
    width: 32px;
    z-index: 2;
  }
  .side-panel-button:hover { opacity: 1; }
  .side-panel-button:focus-visible { box-shadow: 0 0 0 3px rgba(94, 234, 212, 0.35); outline: 1px solid #5eead4; }
  .resize-handle { background: #5eead4; border: 1px solid rgba(3, 7, 18, 0.75); border-radius: 50%; box-sizing: border-box; height: 10px; opacity: 0.58; pointer-events: auto; position: absolute; width: 10px; z-index: 3; }
  .captions:hover .resize-handle { opacity: 0.9; }
  .resize-nw { cursor: nw-resize; left: -5px; top: -5px; }
  .resize-n { cursor: n-resize; left: calc(50% - 5px); top: -5px; }
  .resize-ne { cursor: ne-resize; right: -5px; top: -5px; }
  .resize-e { cursor: e-resize; right: -5px; top: calc(50% - 5px); }
  .resize-se { bottom: -5px; cursor: se-resize; right: -5px; }
  .resize-s { bottom: -5px; cursor: s-resize; left: calc(50% - 5px); }
  .resize-sw { bottom: -5px; cursor: sw-resize; left: -5px; }
  .resize-w { cursor: w-resize; left: -5px; top: calc(50% - 5px); }
  @media (prefers-reduced-motion: no-preference) { .captions { transition: opacity 160ms ease-out; } }
`;

type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

interface PixelRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface Interaction {
  direction: 'move' | ResizeDirection;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startRect: PixelRect;
}

export interface CaptionOverlayCallbacks {
  onLayoutChanged?(layout: OverlayLayout): void;
  onOpenSidePanel?(layout: OverlayLayout): Promise<void> | void;
}

export class CaptionOverlay {
  private captionsElement?: HTMLElement;
  private host?: HTMLElement;
  private interaction?: Interaction;
  private layout?: OverlayLayout;
  private nativeCue?: VTTCue;
  private nativeTrack?: TextTrack;
  private nativeVideo?: HTMLVideoElement;
  private pairs: CaptionPair[] = [];
  private readonly pairElements = new Map<string, HTMLElement>();
  private pendingFrame?: number;
  private pendingPoint?: { x: number; y: number };
  private resizeObserver?: ResizeObserver;
  private statusElement?: HTMLElement;
  private statusTextValue = '';
  private trackElement?: HTMLElement;
  private viewportElement?: HTMLElement;

  constructor(
    private readonly document: Document,
    private readonly callbacks: CaptionOverlayCallbacks = {},
  ) {}

  show(appearance: CaptionAppearance, savedLayout?: OverlayLayout): void {
    if (!this.host) this.createHost();
    this.setAppearance(appearance);
    if (savedLayout) this.layout = normalizeOverlayLayout(savedLayout);
    if (!this.layout) this.layout = this.defaultLayout();
    this.applyLayout();
    this.position();
    this.updateVisiblePairs();
  }

  hide(): void {
    this.disableNativeTextTrack();
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    if (this.pendingFrame !== undefined) {
      this.document.defaultView?.cancelAnimationFrame(this.pendingFrame);
    }
    this.pendingFrame = undefined;
    this.pendingPoint = undefined;
    this.interaction = undefined;
    this.host?.remove();
    this.host = undefined;
    this.captionsElement = undefined;
    this.statusElement = undefined;
    this.trackElement = undefined;
    this.viewportElement = undefined;
    this.pairElements.clear();
    this.pairs = [];
    this.statusTextValue = '';
  }

  setAppearance(appearance: CaptionAppearance): void {
    const style = this.host?.style;
    if (!style) return;
    style.setProperty('--caption-original-size', `${appearance.originalFontSize}px`);
    style.setProperty('--caption-translation-size', `${appearance.translationFontSize}px`);
    style.setProperty('--caption-bg-opacity', `${appearance.backgroundOpacity / 100}`);
    this.updateVisiblePairs();
  }

  setLayout(layout: OverlayLayout): void {
    this.layout = normalizeOverlayLayout(layout);
    this.applyLayout();
    this.position();
  }

  currentLayout(): OverlayLayout {
    if (!this.layout) this.layout = this.defaultLayout();
    return normalizeOverlayLayout(this.layout);
  }

  setWindow(pairs: CaptionPair[]): void {
    this.pairs = pairs;
    this.syncNativeCue();
    const track = this.trackElement;
    if (!track) return;
    const incoming = new Set(pairs.map((pair) => pair.id));
    for (const [id, element] of this.pairElements) {
      if (incoming.has(id)) continue;
      element.remove();
      this.pairElements.delete(id);
    }
    for (const pair of pairs) {
      let element = this.pairElements.get(pair.id);
      if (!element) {
        element = this.createPair(pair);
        this.pairElements.set(pair.id, element);
      } else {
        this.writePair(element, pair);
      }
      track.append(element);
    }
    this.updateVisiblePairs();
  }

  setSessionError(code: string): void {
    this.statusTextValue = t(SESSION_ERROR_KEYS[code] ?? 'errorUnknown');
    if (this.statusElement) this.statusElement.textContent = this.statusTextValue;
    this.syncNativeCue();
    this.updateVisiblePairs();
  }

  clearSessionError(): void {
    this.statusTextValue = '';
    if (this.statusElement) this.statusElement.textContent = '';
    this.syncNativeCue();
    this.updateVisiblePairs();
  }

  position(): void {
    const host = this.host;
    if (!host || !this.layout) return;
    const fullscreenRoot = this.document.fullscreenElement;
    const targetParent = fullscreenRoot instanceof HTMLElement &&
      !(fullscreenRoot instanceof HTMLVideoElement)
      ? fullscreenRoot
      : this.document.documentElement;
    if (host.parentElement !== targetParent) targetParent.append(host);
    if (fullscreenRoot instanceof HTMLVideoElement && this.layout.mode === 'floating') {
      host.style.visibility = 'hidden';
      this.enableNativeTextTrack(fullscreenRoot);
      return;
    }
    this.disableNativeTextTrack();
    host.style.visibility = '';
    this.layout = this.layoutFromPixels(this.pixelRect());
    this.applyLayout();
  }

  private viewportSize(): { height: number; width: number } {
    const view = this.document.defaultView;
    return {
      height: Math.max(1, view?.innerHeight || this.document.documentElement.clientHeight || 720),
      width: Math.max(1, view?.innerWidth || this.document.documentElement.clientWidth || 1280),
    };
  }

  private defaultLayout(): OverlayLayout {
    const viewport = this.viewportSize();
    const bounds = findLargestVisibleVideo(this.document)?.getBoundingClientRect();
    const maxWidth = Math.max(1, viewport.width - VIEWPORT_MARGIN * 2);
    const maxHeight = Math.max(1, viewport.height - VIEWPORT_MARGIN * 2);
    const width = Math.min(maxWidth, Math.max(Math.min(MIN_WIDTH, maxWidth), (bounds?.width ?? viewport.width) * 0.7));
    const height = Math.min(maxHeight, Math.max(Math.min(MIN_HEIGHT, maxHeight), 180));
    const left = bounds ? bounds.left + (bounds.width - width) / 2 : (viewport.width - width) / 2;
    const top = bounds
      ? bounds.bottom - height - Math.max(VIEWPORT_MARGIN, bounds.height * 0.04)
      : viewport.height - height - Math.max(VIEWPORT_MARGIN, viewport.height * 0.08);
    return this.layoutFromPixels({ height, left, top, width });
  }

  private pixelRect(): PixelRect {
    const layout = this.layout ?? this.defaultLayout();
    const viewport = this.viewportSize();
    return this.clampPixelRect({
      height: layout.floatingRect.heightRatio * viewport.height,
      left: layout.floatingRect.xRatio * viewport.width,
      top: layout.floatingRect.yRatio * viewport.height,
      width: layout.floatingRect.widthRatio * viewport.width,
    });
  }

  private clampPixelRect(rect: PixelRect): PixelRect {
    const viewport = this.viewportSize();
    const maxWidth = Math.max(1, viewport.width - VIEWPORT_MARGIN * 2);
    const maxHeight = Math.max(1, viewport.height - VIEWPORT_MARGIN * 2);
    const width = Math.min(maxWidth, Math.max(Math.min(MIN_WIDTH, maxWidth), rect.width));
    const height = Math.min(maxHeight, Math.max(Math.min(MIN_HEIGHT, maxHeight), rect.height));
    return {
      height,
      left: Math.min(viewport.width - width - VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, rect.left)),
      top: Math.min(viewport.height - height - VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, rect.top)),
      width,
    };
  }

  private layoutFromPixels(rect: PixelRect): OverlayLayout {
    const clamped = this.clampPixelRect(rect);
    const viewport = this.viewportSize();
    const floatingRect: FloatingRect = {
      heightRatio: clamped.height / viewport.height,
      widthRatio: clamped.width / viewport.width,
      xRatio: clamped.left / viewport.width,
      yRatio: clamped.top / viewport.height,
    };
    return normalizeOverlayLayout({
      floatingRect,
      mode: this.layout?.mode ?? 'floating',
      version: 1,
    });
  }

  private applyLayout(): void {
    const host = this.host;
    const captions = this.captionsElement;
    if (!host || !captions || !this.layout) return;
    host.style.display = this.layout.mode === 'native' ? 'none' : 'block';
    if (this.layout.mode === 'native') {
      this.disableNativeTextTrack();
      return;
    }
    const rect = this.pixelRect();
    Object.assign(captions.style, {
      height: `${rect.height}px`,
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
    });
    this.updateVisiblePairs();
  }

  private createHost(): void {
    const host = this.document.createElement('div');
    host.dataset.bilingualCaptionRoot = '';
    Object.assign(host.style, {
      display: 'block',
      height: '100vh',
      left: '0px',
      pointerEvents: 'none',
      position: 'fixed',
      top: '0px',
      width: '100vw',
      zIndex: '2147483647',
    });
    const shadow = host.attachShadow({ mode: 'open' });
    const style = this.document.createElement('style');
    style.textContent = OVERLAY_CSS;
    const stage = this.document.createElement('div');
    stage.className = 'stage';
    const captions = this.document.createElement('div');
    captions.className = 'captions';
    captions.setAttribute('aria-live', 'polite');
    captions.setAttribute('role', 'status');
    captions.addEventListener('pointerdown', (event) => this.beginInteraction(event));
    captions.addEventListener('pointermove', (event) => this.moveInteraction(event));
    captions.addEventListener('pointerup', (event) => this.endInteraction(event));
    captions.addEventListener('pointercancel', (event) => this.endInteraction(event));

    const sidePanelButton = this.document.createElement('button');
    sidePanelButton.className = 'side-panel-button';
    sidePanelButton.type = 'button';
    sidePanelButton.textContent = '▤';
    sidePanelButton.title = t('openSidePanel');
    sidePanelButton.setAttribute('aria-label', t('openSidePanel'));
    sidePanelButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    sidePanelButton.addEventListener('click', () => this.openSidePanel());

    const viewport = this.document.createElement('div');
    viewport.className = 'viewport';
    const track = this.document.createElement('div');
    track.className = 'track';
    viewport.append(track);
    const status = this.document.createElement('div');
    status.className = 'status-message';
    status.textContent = this.statusTextValue;
    captions.append(sidePanelButton, viewport, status);
    for (const direction of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
      const handle = this.document.createElement('span');
      handle.className = `resize-handle resize-${direction}`;
      handle.dataset.resizeDirection = direction;
      handle.setAttribute('aria-hidden', 'true');
      captions.append(handle);
    }
    stage.append(captions);
    shadow.append(style, stage);
    this.document.documentElement.append(host);
    this.host = host;
    this.captionsElement = captions;
    this.statusElement = status;
    this.trackElement = track;
    this.viewportElement = viewport;
    for (const pair of this.pairs) {
      const element = this.createPair(pair);
      track.append(element);
      this.pairElements.set(pair.id, element);
    }
    const ResizeObserverConstructor = this.document.defaultView?.ResizeObserver;
    if (ResizeObserverConstructor) {
      this.resizeObserver = new ResizeObserverConstructor(() => this.updateVisiblePairs());
      this.resizeObserver.observe(viewport);
    }
  }

  private beginInteraction(event: PointerEvent): void {
    if (event.button !== 0 || !this.captionsElement || !this.layout) return;
    const target = event.target instanceof Element ? event.target : undefined;
    if (target?.closest('button')) return;
    const direction = target instanceof HTMLElement
      ? target.dataset.resizeDirection as ResizeDirection | undefined
      : undefined;
    this.interaction = {
      direction: direction ?? 'move',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: this.pixelRect(),
    };
    this.captionsElement.classList.add('dragging');
    this.captionsElement.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  private nextInteractionRect(point: { x: number; y: number }): PixelRect | undefined {
    if (!this.interaction) return undefined;
    const dx = point.x - this.interaction.startClientX;
    const dy = point.y - this.interaction.startClientY;
    const next = { ...this.interaction.startRect };
    const direction = this.interaction.direction;
    if (direction === 'move') {
      next.left += dx;
      next.top += dy;
    } else {
      if (direction.includes('e')) next.width += dx;
      if (direction.includes('s')) next.height += dy;
      if (direction.includes('w')) { next.left += dx; next.width -= dx; }
      if (direction.includes('n')) { next.top += dy; next.height -= dy; }
    }
    return next;
  }

  private moveInteraction(event: PointerEvent): void {
    if (!this.interaction || event.pointerId !== this.interaction.pointerId) return;
    this.pendingPoint = { x: event.clientX, y: event.clientY };
    if (this.pendingFrame !== undefined) return;
    const apply = () => {
      this.pendingFrame = undefined;
      const next = this.pendingPoint && this.nextInteractionRect(this.pendingPoint);
      if (!next) return;
      this.layout = this.layoutFromPixels(next);
      this.applyLayout();
    };
    const view = this.document.defaultView;
    this.pendingFrame = view?.requestAnimationFrame
      ? view.requestAnimationFrame(apply)
      : undefined;
    if (this.pendingFrame === undefined) apply();
  }

  private endInteraction(event: PointerEvent): void {
    if (!this.interaction || event.pointerId !== this.interaction.pointerId) return;
    this.pendingPoint = { x: event.clientX, y: event.clientY };
    if (this.pendingFrame !== undefined) {
      this.document.defaultView?.cancelAnimationFrame(this.pendingFrame);
      this.pendingFrame = undefined;
    }
    const next = this.nextInteractionRect(this.pendingPoint);
    if (next) {
      this.layout = this.layoutFromPixels(next);
      this.applyLayout();
    }
    this.captionsElement?.releasePointerCapture?.(event.pointerId);
    this.captionsElement?.classList.remove('dragging');
    this.interaction = undefined;
    this.pendingPoint = undefined;
    if (this.layout) this.callbacks.onLayoutChanged?.(this.currentLayout());
  }

  private openSidePanel(): void {
    const previous = this.currentLayout();
    const next = normalizeOverlayLayout({ ...previous, mode: 'native' });
    this.setLayout(next);
    try {
      const result = this.callbacks.onOpenSidePanel?.(next);
      void Promise.resolve(result).catch(() => this.setLayout(previous));
    } catch {
      this.setLayout(previous);
    }
  }

  private updateVisiblePairs(): void {
    const viewport = this.viewportElement;
    if (!viewport) return;
    const elements = this.pairs.flatMap((pair) => {
      const element = this.pairElements.get(pair.id);
      return element ? [element] : [];
    });
    for (const element of elements) element.dataset.hidden = 'false';
    const available = viewport.clientHeight;
    if (available <= 0) return;
    let used = 0;
    for (let index = elements.length - 1; index >= 0; index -= 1) {
      const element = elements[index]!;
      const pairHeight = element.offsetHeight;
      const fits = pairHeight > 0 && used + pairHeight <= available;
      element.dataset.hidden = fits ? 'false' : 'true';
      if (fits) used += pairHeight;
    }
  }

  private createPair(pair: CaptionPair): HTMLElement {
    const element = this.document.createElement('div');
    element.className = 'pair';
    element.dataset.pairId = pair.id;
    const original = this.document.createElement('div');
    original.className = 'original';
    const translation = this.document.createElement('div');
    translation.className = 'translation';
    element.append(original, translation);
    this.writePair(element, pair);
    return element;
  }

  private writePair(element: HTMLElement, pair: CaptionPair): void {
    const original = element.querySelector('.original');
    const translation = element.querySelector('.translation');
    if (original) original.textContent = pair.original;
    if (translation) translation.textContent = pair.translation;
  }

  private enableNativeTextTrack(video: HTMLVideoElement): void {
    if (this.nativeVideo === video) return;
    this.disableNativeTextTrack();
    const Cue = this.document.defaultView?.VTTCue;
    if (!Cue) return;
    const track = video.addTextTrack('captions', t('captionTrackLabel'));
    track.mode = 'showing';
    const cue = new Cue(0, 1_000_000_000, '');
    track.addCue(cue);
    this.nativeCue = cue;
    this.nativeTrack = track;
    this.nativeVideo = video;
    this.syncNativeCue();
  }

  private disableNativeTextTrack(): void {
    if (this.nativeCue) {
      try {
        this.nativeTrack?.removeCue(this.nativeCue);
      } catch {
        // Some players remove extension-created cues during navigation.
      }
    }
    if (this.nativeTrack) this.nativeTrack.mode = 'disabled';
    this.nativeCue = undefined;
    this.nativeTrack = undefined;
    this.nativeVideo = undefined;
  }

  private syncNativeCue(): void {
    if (!this.nativeCue) return;
    this.nativeCue.text = [
      ...this.pairs.flatMap((pair) => [pair.original, pair.translation]),
      this.statusTextValue,
    ].filter(Boolean).join('\n');
  }
}
