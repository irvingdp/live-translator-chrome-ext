import { installMediaPlaybackWatcher } from '../src/content/media-playback-watcher';

export default defineUnlistedScript(() => {
  installMediaPlaybackWatcher(document);
});
