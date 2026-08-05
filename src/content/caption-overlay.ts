export interface CaptionSizes {
  originalFontSize: number;
  translationFontSize: number;
}

export interface OverlayTranslation {
  mode: 'append' | 'replace';
  segmentId: string;
  text: string;
}

const SESSION_ERROR_MESSAGES: Record<string, string> = {
  deepgram_disconnected: 'Deepgram 字幕連線中斷，請重新啟動',
  invalid_credentials: 'DeepL API Key 無效，請到設定頁更新',
  invalid_response: 'DeepL 回傳了無法辨識的資料',
  provider_unavailable: 'DeepL 服務暫時無法使用',
  quota_exceeded: 'DeepL 本月翻譯額度已用完',
  rate_limited: 'DeepL 請求過於頻繁，請稍後再試',
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

const OVERLAY_CSS = `
  :host { all: initial; }
  .stage {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    height: 100%;
    justify-content: flex-end;
    padding: 0 5% 5%;
    pointer-events: none;
    width: 100%;
  }
  .captions {
    align-self: center;
    background: rgba(3, 7, 18, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.34);
    box-sizing: border-box;
    color: #fff;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.35;
    max-width: min(92%, 1100px);
    padding: 8px 14px;
    text-align: center;
    text-wrap: balance;
  }
  .original {
    font-size: var(--caption-original-size, 24px);
    font-weight: 650;
    overflow-wrap: anywhere;
    text-shadow: 0 1px 2px #000;
  }
  .translation {
    color: #fde68a;
    font-size: var(--caption-translation-size, 22px);
    font-weight: 550;
    margin-top: 3px;
    overflow-wrap: anywhere;
    text-shadow: 0 1px 2px #000;
  }
  .original:empty, .translation:empty { display: none; }
  @media (prefers-reduced-motion: no-preference) {
    .captions { transition: opacity 160ms ease-out; }
  }
`;

export class CaptionOverlay {
  private activeSegmentId?: string;
  private host?: HTMLElement;
  private nativeCue?: VTTCue;
  private nativeTrack?: TextTrack;
  private nativeVideo?: HTMLVideoElement;
  private originalElement?: HTMLElement;
  private originalTextValue = '';
  private readonly translations = new Map<string, string>();
  private translationElement?: HTMLElement;

  constructor(private readonly document: Document) {}

  show(sizes: CaptionSizes): void {
    if (!this.host) this.createHost();
    this.setSizes(sizes);
    this.position();
  }

  hide(): void {
    this.disableNativeTextTrack();
    this.host?.remove();
    this.host = undefined;
    this.originalElement = undefined;
    this.translationElement = undefined;
    this.activeSegmentId = undefined;
    this.originalTextValue = '';
    this.translations.clear();
  }

  setSizes(sizes: CaptionSizes): void {
    this.host?.style.setProperty(
      '--caption-original-size',
      `${sizes.originalFontSize}px`,
    );
    this.host?.style.setProperty(
      '--caption-translation-size',
      `${sizes.translationFontSize}px`,
    );
  }

  setOriginal(segmentId: string, text: string): void {
    this.activeSegmentId = segmentId;
    this.originalTextValue = text;
    if (this.originalElement) this.originalElement.textContent = text;
    if (this.translationElement) {
      this.translationElement.textContent = this.translations.get(segmentId) ?? '';
    }
    this.syncNativeCue();
  }

  setSessionError(code: string): void {
    this.setOriginal(
      'session-error',
      SESSION_ERROR_MESSAGES[code] ?? '字幕服務發生未知錯誤，請重新啟動',
    );
  }

  setTranslation(update: OverlayTranslation): void {
    const previous = this.translations.get(update.segmentId) ?? '';
    const next =
      update.mode === 'replace'
        ? update.text
        : [previous, update.text].filter(Boolean).join(' ');
    this.translations.set(update.segmentId, next);
    this.activeSegmentId ??= update.segmentId;
    if (this.activeSegmentId === update.segmentId && this.translationElement) {
      this.translationElement.textContent = next;
    }
    this.syncNativeCue();
  }

  translationText(): string {
    return this.translationElement?.textContent ?? '';
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
    const original = this.document.createElement('div');
    original.className = 'original';
    const translation = this.document.createElement('div');
    translation.className = 'translation';
    captions.append(original, translation);
    stage.append(captions);
    shadow.append(style, stage);
    this.document.documentElement.append(host);
    this.host = host;
    this.originalElement = original;
    this.translationElement = translation;
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
    const translation = this.activeSegmentId
      ? this.translations.get(this.activeSegmentId) ?? ''
      : '';
    this.nativeCue.text = [this.originalTextValue, translation]
      .filter(Boolean)
      .join('\n');
  }
}
