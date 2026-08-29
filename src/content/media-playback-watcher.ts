import type {
  MediaPlaybackRequest,
  MediaPlaybackResponse,
} from '../core/media-playback';
import type { ExtensionMessage } from '../core/messages';
import { findLargestVisibleVideo } from './media-locator';

const INSTALL_KEY = '__bilingualMediaPlaybackWatcherInstalled';

type PlaybackWindow = Window & {
  [INSTALL_KEY]?: boolean;
};

export function isPrimaryVideoPlaying(document: Document): boolean {
  const video = findLargestVisibleVideo(document);
  return Boolean(video && !video.paused && !video.ended);
}

export function installMediaPlaybackWatcher(document: Document): () => void {
  const view = document.defaultView as PlaybackWindow | null;
  if (!view || view[INSTALL_KEY]) return () => undefined;
  view[INSTALL_KEY] = true;

  let reportTimer: number | undefined;
  const reportIfPlaying = () => {
    if (reportTimer !== undefined) view.clearTimeout(reportTimer);
    reportTimer = view.setTimeout(() => {
      reportTimer = undefined;
      if (!isPrimaryVideoPlaying(document)) return;
      void chrome.runtime.sendMessage({
        target: 'background',
        type: 'MEDIA_PLAYING',
      } satisfies ExtensionMessage).catch(() => undefined);
    }, 0);
  };
  const handlePlay = (event: Event) => {
    if (event.target instanceof HTMLVideoElement) reportIfPlaying();
  };
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') reportIfPlaying();
  };
  const handleMessage = (
    message: MediaPlaybackRequest,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: MediaPlaybackResponse) => void,
  ) => {
    if (message?.type !== 'MEDIA_PLAYBACK_STATUS') return false;
    sendResponse({ playing: isPrimaryVideoPlaying(document) });
    return false;
  };

  document.addEventListener('play', handlePlay, true);
  document.addEventListener('visibilitychange', handleVisibility);
  view.addEventListener('focus', reportIfPlaying);
  chrome.runtime.onMessage.addListener(handleMessage);
  reportIfPlaying();

  return () => {
    if (reportTimer !== undefined) view.clearTimeout(reportTimer);
    document.removeEventListener('play', handlePlay, true);
    document.removeEventListener('visibilitychange', handleVisibility);
    view.removeEventListener('focus', reportIfPlaying);
    chrome.runtime.onMessage.removeListener(handleMessage);
    delete view[INSTALL_KEY];
  };
}
