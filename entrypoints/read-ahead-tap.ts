import { installBufferTap } from '../src/read-ahead/youtube-buffer-tap';
import { installCaptionTap } from '../src/read-ahead/youtube-caption-tap';

// Runs in the page's MAIN world on YouTube; see src/read-ahead/youtube-buffer-tap.ts
// and src/read-ahead/youtube-caption-tap.ts.
export default defineUnlistedScript(() => {
  installBufferTap(window);
  installCaptionTap(window);
});
