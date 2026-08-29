const MIN_WIDTH = 280;
const MIN_PLAYER_FRAME_HEIGHT = 160;

const PLAYER_FRAME_HINT =
  /(?:video|player|embed|stream|youtube|youtu\.be|vimeo|dailymotion|twitch)/i;

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

function visibleArea(rect: DOMRect, document: Document): number {
  const view = document.defaultView;
  const viewportWidth = Math.max(
    1,
    view?.innerWidth || document.documentElement.clientWidth || 1280,
  );
  const viewportHeight = Math.max(
    1,
    view?.innerHeight || document.documentElement.clientHeight || 720,
  );
  const width = Math.max(
    0,
    Math.min(viewportWidth, rect.right) - Math.max(0, rect.left),
  );
  const height = Math.max(
    0,
    Math.min(viewportHeight, rect.bottom) - Math.max(0, rect.top),
  );
  return width * height;
}

export function findLargestVisiblePlayerFrame(
  document: Document,
): HTMLIFrameElement | undefined {
  return Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'))
    .map((frame) => {
      const rect = frame.getBoundingClientRect();
      const visible = visibleArea(rect, document);
      const descriptor = [
        frame.src,
        frame.title,
        frame.name,
        frame.id,
        frame.className,
      ].join(' ');
      const hasPlayerHint = PLAYER_FRAME_HINT.test(descriptor);
      const hasMediaPermission =
        frame.hasAttribute('allowfullscreen') ||
        /(?:autoplay|fullscreen|picture-in-picture)/i.test(
          frame.getAttribute('allow') ?? '',
        );
      const aspectRatio = rect.height > 0 ? rect.width / rect.height : 0;
      const hasVideoShape =
        rect.width >= 320 &&
        rect.height >= 180 &&
        aspectRatio >= 1.25 &&
        aspectRatio <= 2.4;
      const confidence =
        1 +
        (hasPlayerHint ? 2 : 0) +
        (hasMediaPermission ? 1 : 0) +
        (hasVideoShape ? 1 : 0);
      return {
        frame,
        isCandidate:
          visible > 0 &&
          rect.width >= MIN_WIDTH &&
          rect.height >= MIN_PLAYER_FRAME_HEIGHT &&
          (hasPlayerHint || hasMediaPermission || hasVideoShape),
        score: visible * confidence,
      };
    })
    .filter((candidate) => candidate.isCandidate)
    .sort((left, right) => right.score - left.score)[0]?.frame;
}

export function findLargestVisibleVideo(
  document: Document,
): HTMLVideoElement | undefined {
  return videoCandidates(document)
    .map((video) => ({ video, rect: video.getBoundingClientRect() }))
    .filter(({ rect }) => visibleArea(rect, document) > 0)
    .sort(
      (left, right) =>
        visibleArea(right.rect, document) - visibleArea(left.rect, document),
    )[0]?.video;
}

export function visibleMediaArea(element: Element, document: Document): number {
  return visibleArea(element.getBoundingClientRect(), document);
}
