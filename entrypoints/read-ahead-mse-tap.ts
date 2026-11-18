import { installMseTap } from '../src/read-ahead/mse-buffer-tap';

// Registered at document_start in the MAIN world of each allowed site (ADR
// 0005); see src/read-ahead/mse-buffer-tap.ts.
export default defineUnlistedScript(() => {
  installMseTap(window);
});
