import { installBufferTap } from '../src/read-ahead/youtube-buffer-tap';

// Runs in the page's MAIN world on YouTube; see src/read-ahead/youtube-buffer-tap.ts.
export default defineUnlistedScript(() => {
  installBufferTap(window);
});
