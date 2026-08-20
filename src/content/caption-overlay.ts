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
const TITLEBAR_HEIGHT = 32;
const RESIZE_HANDLE_OFFSET = 10;
const HOVER_BUFFER = 18;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 80;

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
    box-sizing: border-box;
    color: #fff;
    display: flex;
    flex-direction: column;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.35;
    overflow: visible;
    pointer-events: none;
    position: absolute;
    text-align: center;
    touch-action: none;
    user-select: none;
  }
  .caption-body {
    background: rgba(3, 7, 18, var(--caption-bg-opacity, 0.78));
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.34);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    padding: 12px 14px 10px;
    transition: border-radius 140ms ease-out, border-top-color 140ms ease-out;
  }
  .viewport { display: flex; flex: 1; flex-direction: column; justify-content: flex-end; min-height: 0; overflow: hidden; pointer-events: none; }
  .track { display: flex; flex-direction: column; justify-content: flex-end; }
  .pair { padding: 2px 0; }
  .pair[data-hidden="true"] { display: none; }
  .original { color: var(--caption-original-color, #fff); font-size: var(--caption-original-size, 24px); font-weight: 650; overflow-wrap: break-word; text-shadow: 0 1px 2px #000; }
  .translation { color: var(--caption-translation-color, #fde68a); font-size: var(--caption-translation-size, 22px); font-weight: 550; margin-top: 3px; overflow-wrap: break-word; text-shadow: 0 1px 2px #000; }
  .status-message { color: #fca5a5; flex: 0 0 auto; font-size: 16px; font-weight: 600; margin-top: 5px; overflow-wrap: anywhere; pointer-events: none; text-shadow: 0 1px 2px #000; }
  .original:empty, .translation:empty, .status-message:empty { display: none; }
  .caption-toolbar {
    align-items: center;
    background: linear-gradient(to bottom, rgba(17, 24, 39, 0.96), rgba(17, 24, 39, 0.86));
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-bottom-color: rgba(255, 255, 255, 0.1);
    border-radius: 10px 10px 0 0;
    bottom: 100%;
    box-sizing: border-box;
    display: flex;
    height: ${TITLEBAR_HEIGHT}px;
    justify-content: space-between;
    left: 0;
    opacity: 0;
    padding: 0 8px 0 10px;
    pointer-events: none;
    position: absolute;
    right: 0;
    transform: translateY(6px);
    transition: opacity 140ms ease-out, transform 140ms ease-out;
    z-index: 4;
  }
  .captions.proximity-hover .caption-toolbar,
  .captions:focus-within .caption-toolbar,
  .captions.interacting .caption-toolbar { opacity: 1; pointer-events: auto; transform: translateY(0); }
  .captions.proximity-hover .caption-body,
  .captions:focus-within .caption-body,
  .captions.interacting .caption-body { border-radius: 0 0 10px 10px; border-top-color: transparent; }
  .drag-region { align-items: center; color: rgba(255, 255, 255, 0.6); cursor: grab; display: flex; flex: 1; gap: 6px; height: 100%; min-width: 0; }
  .captions.moving .drag-region { cursor: grabbing; }
  .toolbar-label { font: 700 9px/1 system-ui, sans-serif; letter-spacing: 0.12em; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
  .toolbar-actions { align-items: center; display: flex; gap: 3px; }
  .toolbar-button {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.72);
    cursor: pointer;
    display: flex;
    height: 26px;
    justify-content: center;
    padding: 0;
    width: 28px;
  }
  .toolbar-button:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
  .toolbar-button:focus-visible { box-shadow: 0 0 0 3px rgba(94, 234, 212, 0.35); outline: 1px solid #5eead4; }
  .side-panel-button { color: #99f6e4; }
  .toolbar-icon { fill: none; height: 16px; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; width: 16px; }
  .resize-handle {
    background: transparent;
    box-sizing: border-box;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.65));
    height: 16px;
    opacity: 0;
    pointer-events: none;
    position: absolute;
    transition: opacity 140ms ease-out, transform 140ms ease-out;
    width: 16px;
    z-index: 5;
  }
  .captions.proximity-hover .resize-handle,
  .captions:focus-within .resize-handle,
  .captions.interacting .resize-handle { opacity: 0.95; pointer-events: auto; }
  .resize-handle:hover { transform: scale(1.15); }
  .resize-nw { border-left: 5px solid #5eead4; border-top: 5px solid #5eead4; border-top-left-radius: 9px; cursor: nw-resize; left: -${RESIZE_HANDLE_OFFSET}px; top: -${TITLEBAR_HEIGHT + RESIZE_HANDLE_OFFSET}px; }
  .resize-ne { border-right: 5px solid #5eead4; border-top: 5px solid #5eead4; border-top-right-radius: 9px; cursor: ne-resize; right: -${RESIZE_HANDLE_OFFSET}px; top: -${TITLEBAR_HEIGHT + RESIZE_HANDLE_OFFSET}px; }
  .resize-se { border-bottom: 5px solid #5eead4; border-bottom-right-radius: 9px; border-right: 5px solid #5eead4; bottom: -${RESIZE_HANDLE_OFFSET}px; cursor: se-resize; right: -${RESIZE_HANDLE_OFFSET}px; }
  .resize-sw { border-bottom: 5px solid #5eead4; border-bottom-left-radius: 9px; border-left: 5px solid #5eead4; bottom: -${RESIZE_HANDLE_OFFSET}px; cursor: sw-resize; left: -${RESIZE_HANDLE_OFFSET}px; }
  @media (prefers-reduced-motion: reduce) { .caption-body, .caption-toolbar, .resize-handle { transition: none; } }
`;

type ResizeDirection = 'ne' | 'se' | 'sw' | 'nw';

function createIcon(document: Document, paths: string[]): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.classList.add('toolbar-icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  icon.setAttribute('viewBox', '0 0 24 24');
  for (const data of paths) {
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', data);
    icon.append(path);
  }
  return icon;
}

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
  private transitionSuspended = false;
  private viewportElement?: HTMLElement;
  private readonly clearPointerProximity = () => {
    this.captionsElement?.classList.remove('proximity-hover');
  };
  private readonly trackPointerProximity = (event: PointerEvent) => {
    const captions = this.captionsElement;
    if (
      !captions ||
      this.layout?.mode !== 'floating' ||
      event.pointerType === 'touch'
    ) {
      this.clearPointerProximity();
      return;
    }
    const bounds = captions.getBoundingClientRect();
    const nearby =
      event.clientX >= bounds.left - HOVER_BUFFER &&
      event.clientX <= bounds.right + HOVER_BUFFER &&
      event.clientY >= bounds.top - TITLEBAR_HEIGHT - HOVER_BUFFER &&
      event.clientY <= bounds.bottom + HOVER_BUFFER;
    captions.classList.toggle('proximity-hover', nearby);
  };

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
    this.transitionSuspended = false;
    this.disableNativeTextTrack();
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    if (this.pendingFrame !== undefined) {
      this.document.defaultView?.cancelAnimationFrame(this.pendingFrame);
    }
    this.pendingFrame = undefined;
    this.pendingPoint = undefined;
    this.interaction = undefined;
    this.document.removeEventListener(
      'pointermove',
      this.trackPointerProximity,
      true,
    );
    this.document.defaultView?.removeEventListener(
      'blur',
      this.clearPointerProximity,
    );
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

  suspendForFullscreenTransition(): void {
    if (!this.host) return;
    this.transitionSuspended = true;
    this.clearPointerProximity();
    this.host.remove();
  }

  resumeAfterFullscreenTransition(): void {
    if (!this.transitionSuspended) return;
    this.transitionSuspended = false;
    this.position();
  }

  setAppearance(appearance: CaptionAppearance): void {
    const style = this.host?.style;
    if (!style) return;
    style.setProperty('--caption-original-size', `${appearance.originalFontSize}px`);
    style.setProperty('--caption-original-color', appearance.originalTextColor);
    style.setProperty('--caption-translation-size', `${appearance.translationFontSize}px`);
    style.setProperty('--caption-translation-color', appearance.translationTextColor);
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
    if (!host || !this.layout || this.transitionSuspended) return;
    const fullscreenRoot = this.document.fullscreenElement;
    const normalParent = this.document.body ?? this.document.documentElement;
    const targetParent = fullscreenRoot instanceof HTMLElement &&
      fullscreenRoot !== this.document.documentElement &&
      !(fullscreenRoot instanceof HTMLVideoElement)
      ? fullscreenRoot
      : normalParent;
    if (host.parentElement !== targetParent) targetParent.append(host);
    if (fullscreenRoot instanceof HTMLVideoElement && this.layout.mode === 'floating') {
      this.clearPointerProximity();
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
    const horizontalMargin = Math.max(VIEWPORT_MARGIN, RESIZE_HANDLE_OFFSET);
    const topMargin = Math.max(
      VIEWPORT_MARGIN,
      TITLEBAR_HEIGHT + RESIZE_HANDLE_OFFSET,
    );
    const bottomMargin = Math.max(VIEWPORT_MARGIN, RESIZE_HANDLE_OFFSET);
    const maxWidth = Math.max(1, viewport.width - horizontalMargin * 2);
    const maxHeight = Math.max(1, viewport.height - topMargin - bottomMargin);
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
    const horizontalMargin = Math.max(VIEWPORT_MARGIN, RESIZE_HANDLE_OFFSET);
    const topMargin = Math.max(
      VIEWPORT_MARGIN,
      TITLEBAR_HEIGHT + RESIZE_HANDLE_OFFSET,
    );
    const bottomMargin = Math.max(VIEWPORT_MARGIN, RESIZE_HANDLE_OFFSET);
    const maxWidth = Math.max(1, viewport.width - horizontalMargin * 2);
    const maxHeight = Math.max(1, viewport.height - topMargin - bottomMargin);
    const width = Math.min(maxWidth, Math.max(Math.min(MIN_WIDTH, maxWidth), rect.width));
    const height = Math.min(maxHeight, Math.max(Math.min(MIN_HEIGHT, maxHeight), rect.height));
    return {
      height,
      left: Math.min(
        viewport.width - width - horizontalMargin,
        Math.max(horizontalMargin, rect.left),
      ),
      top: Math.min(
        viewport.height - height - bottomMargin,
        Math.max(topMargin, rect.top),
      ),
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
      this.clearPointerProximity();
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
    captions.addEventListener('pointerdown', (event) => this.beginInteraction(event));
    captions.addEventListener('pointermove', (event) => this.moveInteraction(event));
    captions.addEventListener('pointerup', (event) => this.endInteraction(event));
    captions.addEventListener('pointercancel', (event) => this.endInteraction(event));

    const toolbar = this.document.createElement('div');
    toolbar.className = 'caption-toolbar';
    const dragRegion = this.document.createElement('div');
    dragRegion.className = 'drag-region';
    dragRegion.dataset.dragHandle = '';
    dragRegion.append(createIcon(this.document, [
      'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
    ]));
    const toolbarLabel = this.document.createElement('span');
    toolbarLabel.className = 'toolbar-label';
    toolbarLabel.textContent = t('captionOverlayTitle');
    dragRegion.append(toolbarLabel);
    const toolbarActions = this.document.createElement('div');
    toolbarActions.className = 'toolbar-actions';

    const sidePanelButton = this.document.createElement('button');
    sidePanelButton.className = 'toolbar-button side-panel-button';
    sidePanelButton.type = 'button';
    sidePanelButton.append(createIcon(this.document, [
      'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
      'M9 3v18',
    ]));
    sidePanelButton.title = t('openSidePanel');
    sidePanelButton.setAttribute('aria-label', t('openSidePanel'));
    sidePanelButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    sidePanelButton.addEventListener('click', () => this.openSidePanel());

    toolbarActions.append(sidePanelButton);
    toolbar.append(dragRegion, toolbarActions);

    const body = this.document.createElement('div');
    body.className = 'caption-body';
    const viewport = this.document.createElement('div');
    viewport.className = 'viewport';
    viewport.setAttribute('aria-live', 'polite');
    viewport.setAttribute('role', 'status');
    const track = this.document.createElement('div');
    track.className = 'track';
    viewport.append(track);
    const status = this.document.createElement('div');
    status.className = 'status-message';
    status.textContent = this.statusTextValue;
    body.append(viewport, status);
    captions.append(toolbar, body);
    for (const direction of ['nw', 'ne', 'se', 'sw'] as const) {
      const handle = this.document.createElement('span');
      handle.className = `resize-handle resize-${direction}`;
      handle.dataset.resizeDirection = direction;
      handle.setAttribute('aria-hidden', 'true');
      captions.append(handle);
    }
    stage.append(captions);
    shadow.append(style, stage);
    (this.document.body ?? this.document.documentElement).append(host);
    this.host = host;
    this.captionsElement = captions;
    this.statusElement = status;
    this.trackElement = track;
    this.viewportElement = viewport;
    this.document.addEventListener('pointermove', this.trackPointerProximity, {
      capture: true,
      passive: true,
    });
    this.document.defaultView?.addEventListener(
      'blur',
      this.clearPointerProximity,
    );
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
    const resizeHandle = target?.closest<HTMLElement>('[data-resize-direction]');
    const dragHandle = target?.closest<HTMLElement>('[data-drag-handle]');
    if (!resizeHandle && !dragHandle) return;
    const direction = resizeHandle?.dataset.resizeDirection as
      | ResizeDirection
      | undefined;
    this.interaction = {
      direction: direction ?? 'move',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: this.pixelRect(),
    };
    this.captionsElement.classList.add('interacting');
    this.captionsElement.classList.toggle('moving', direction === undefined);
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
    this.captionsElement?.classList.remove('interacting', 'moving');
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
