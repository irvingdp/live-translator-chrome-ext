import type { CaptionPair } from '../core/caption-window';

export interface CaptionAppearance {
  backgroundOpacity: number;
  bottomOffset: number;
  captionWidth: number;
  originalFontSize: number;
  translationFontSize: number;
}

const SESSION_ERROR_MESSAGES: Record<string, string> = {
  deepgram_disconnected: 'Deepgram 字幕連線中斷，請重新啟動',
  invalid_credentials: 'DeepL API Key 無效，請到設定頁更新',
  invalid_response: 'DeepL 回傳了無法辨識的資料',
  provider_unavailable: 'DeepL 服務暫時無法使用',
  quota_exceeded: 'DeepL 本月翻譯額度已用完',
  rate_limited: 'DeepL 請求過於頻繁，請稍後再試',
  translation_disabled: 'DeepL 連續失敗 5 次，本次字幕已停止翻譯',
  translation_failed: 'DeepL 翻譯失敗，英文字幕仍會繼續',
};

function videoCandidates(document: Document): HTMLVideoElement[] {
  const hostname = document.location.hostname;
  const preferredSelector = hostname.includes('youtube.com')
    ? 'video.html5-main-video'
    : hostname.includes('netflix.com')
      ? 'video'
      : hostname.includes('disneyplus.com')
        ? '[data-testid="video-player"] video, video'
        : 'video';
  return Array.from(document.querySelectorAll<HTMLVideoElement>(preferredSelector));
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

const PUSH_DURATION_MS = 220;

const OVERLAY_CSS = `
  :host { all: initial; }
  .stage {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    height: 100%;
    justify-content: flex-end;
    padding: 0 5% var(--caption-bottom-offset, 8%);
    pointer-events: none;
    width: 100%;
  }
  .captions {
    align-self: center;
    background: rgba(3, 7, 18, var(--caption-bg-opacity, 0.78));
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.34);
    box-sizing: border-box;
    color: #fff;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.35;
    /* Sized from its own setting rather than its content, so the box stops
       resizing on every caption. A share of the video width keeps it
       independent of the font size and of how many characters a line holds. */
    box-sizing: border-box;
    padding: 8px 14px;
    text-align: center;
    width: var(--caption-width, 80%);
  }
  .viewport {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    overflow: hidden;
  }
  .track { display: flex; flex-direction: column; }
  .pair { padding: 2px 0; }
  .original {
    font-size: var(--caption-original-size, 24px);
    font-weight: 650;
    overflow-wrap: break-word;
    text-shadow: 0 1px 2px #000;
  }
  .translation {
    color: #fde68a;
    font-size: var(--caption-translation-size, 22px);
    font-weight: 550;
    margin-top: 3px;
    overflow-wrap: break-word;
    text-shadow: 0 1px 2px #000;
  }
  .status-message {
    color: #fca5a5;
    font-size: 16px;
    font-weight: 600;
    margin-top: 5px;
    overflow-wrap: anywhere;
    text-shadow: 0 1px 2px #000;
  }
  .original:empty, .translation:empty, .status-message:empty { display: none; }
  .track.instant { transition: none; }
  @media (prefers-reduced-motion: no-preference) {
    .captions { transition: opacity 160ms ease-out; }
    .track { transition: transform 220ms ease-out; }
  }
`;

export class CaptionOverlay {
  private host?: HTMLElement;
  private nativeCue?: VTTCue;
  private nativeTrack?: TextTrack;
  private nativeVideo?: HTMLVideoElement;
  private pairs: CaptionPair[] = [];
  private readonly pairElements = new Map<string, HTMLElement>();
  private statusElement?: HTMLElement;
  private statusTextValue = '';
  private trackElement?: HTMLElement;
  private viewportElement?: HTMLElement;

  constructor(private readonly document: Document) {}

  show(appearance: CaptionAppearance): void {
    if (!this.host) this.createHost();
    this.setAppearance(appearance);
    this.position();
  }

  hide(): void {
    this.disableNativeTextTrack();
    this.host?.remove();
    this.host = undefined;
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
    style.setProperty(
      '--caption-original-size',
      `${appearance.originalFontSize}px`,
    );
    style.setProperty(
      '--caption-translation-size',
      `${appearance.translationFontSize}px`,
    );
    style.setProperty(
      '--caption-bg-opacity',
      `${appearance.backgroundOpacity / 100}`,
    );
    style.setProperty('--caption-bottom-offset', `${appearance.bottomOffset}%`);
    style.setProperty('--caption-width', `${appearance.captionWidth}%`);
  }

  // Idempotent: the background owns accumulation and sends the whole window on
  // every change, so this only reconciles the DOM against the given pairs.
  setWindow(pairs: CaptionPair[]): void {
    this.pairs = pairs;
    this.syncNativeCue();
    const track = this.trackElement;
    if (!track) return;

    const incoming = new Set(pairs.map((pair) => pair.id));
    const outgoing = [...track.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !incoming.has(child.dataset.pairId ?? ''),
    );

    // Nothing arriving means there is no motion for a drop to ride out on,
    // and going from one unit to two just grows the box with nothing above
    // to push out.
    const pushes =
      outgoing.length > 0 &&
      pairs.some((pair) => !this.pairElements.has(pair.id)) &&
      !this.prefersReducedMotion();
    // Measured before the append: this is the height the box must hold for
    // the whole push. Reading it afterwards would pin the taller height that
    // includes the incoming unit, which is exactly the growth the push hides
    // -- and would also make the pin a no-op, since it is released in the
    // same breath as the outgoing unit is removed.
    const pinnedHeight = pushes ? (this.viewportElement?.offsetHeight ?? 0) : 0;

    for (const pair of pairs) {
      const existing = this.pairElements.get(pair.id);
      if (existing) {
        this.writePair(existing, pair);
        continue;
      }
      const element = this.createPair(pair);
      track.append(element);
      this.pairElements.set(pair.id, element);
    }

    if (outgoing.length === 0) return;
    if (!pushes) {
      this.removePairs(outgoing);
      return;
    }
    this.animatePush(outgoing, pinnedHeight);
  }

  private prefersReducedMotion(): boolean {
    const view = this.document.defaultView;
    return (
      view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    );
  }

  // The track is bottom-aligned, so appending already moved the older units up
  // by the outgoing height. Offsetting the track by that measured distance and
  // releasing it on the next frame replays that jump as a slide, which keeps
  // the animation in step with the real layout instead of a guessed height.
  private animatePush(outgoing: HTMLElement[], pinnedHeight: number): void {
    const track = this.trackElement;
    const viewport = this.viewportElement;
    if (!track || !viewport) {
      this.removePairs(outgoing);
      return;
    }
    const distance = outgoing.reduce(
      (total, element) => total + element.offsetHeight,
      0,
    );
    if (pinnedHeight > 0) viewport.style.height = `${pinnedHeight}px`;
    track.classList.add('instant');
    track.style.transform = `translateY(${distance}px)`;
    void track.offsetHeight;

    const view = this.document.defaultView;
    const release = () => {
      track.classList.remove('instant');
      track.style.transform = '';
    };
    if (view?.requestAnimationFrame) view.requestAnimationFrame(release);
    else release();

    const finish = () => {
      this.removePairs(outgoing);
      release();
      viewport.style.height = '';
    };
    if (view?.setTimeout) view.setTimeout(finish, PUSH_DURATION_MS + 40);
    else finish();
  }

  setSessionError(code: string): void {
    this.statusTextValue =
      SESSION_ERROR_MESSAGES[code] ?? '字幕服務發生未知錯誤，請重新啟動';

    if (this.statusElement) {
      this.statusElement.textContent = this.statusTextValue;
    }
    this.syncNativeCue();
  }

  clearSessionError(): void {
    this.statusTextValue = '';
    if (this.statusElement) this.statusElement.textContent = '';
    this.syncNativeCue();
  }

  position(): void {
    if (!this.host) return;
    const fullscreenRoot = this.document.fullscreenElement;
    const targetParent =
      fullscreenRoot instanceof HTMLElement &&
      !(fullscreenRoot instanceof HTMLVideoElement)
        ? fullscreenRoot
        : this.document.documentElement;
    if (this.host.parentElement !== targetParent) targetParent.append(this.host);
    if (fullscreenRoot instanceof HTMLVideoElement) {
      this.enableNativeTextTrack(fullscreenRoot);
    } else {
      this.disableNativeTextTrack();
    }

    const video = findLargestVisibleVideo(this.document);
    if (!video) {
      Object.assign(this.host.style, {
        height: '100vh',
        left: '0px',
        top: '0px',
        width: '100vw',
      });
      this.host.dataset.mode = 'viewport';
      return;
    }

    const bounds = video.getBoundingClientRect();
    Object.assign(this.host.style, {
      height: `${bounds.height}px`,
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
    });
    this.host.dataset.mode = 'video';
  }

  private createHost(): void {
    const host = this.document.createElement('div');
    host.dataset.bilingualCaptionRoot = '';
    Object.assign(host.style, {
      display: 'block',
      pointerEvents: 'none',
      position: 'fixed',
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
    const viewport = this.document.createElement('div');
    viewport.className = 'viewport';
    const track = this.document.createElement('div');
    track.className = 'track';
    viewport.append(track);
    const status = this.document.createElement('div');
    status.className = 'status-message';
    status.textContent = this.statusTextValue;
    captions.append(viewport, status);
    stage.append(captions);
    shadow.append(style, stage);
    this.document.documentElement.append(host);
    this.host = host;
    this.statusElement = status;
    this.trackElement = track;
    this.viewportElement = viewport;
    for (const pair of this.pairs) {
      const element = this.createPair(pair);
      track.append(element);
      this.pairElements.set(pair.id, element);
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

  private removePairs(elements: HTMLElement[]): void {
    for (const element of elements) {
      const id = element.dataset.pairId;
      if (id) this.pairElements.delete(id);
      element.remove();
    }
  }

  private enableNativeTextTrack(video: HTMLVideoElement): void {
    if (this.nativeVideo === video) return;
    this.disableNativeTextTrack();
    const Cue = this.document.defaultView?.VTTCue;
    if (!Cue) return;
    const track = video.addTextTrack('captions', '雙語即時字幕');
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
    ]
      .filter(Boolean)
      .join('\n');
  }
}
