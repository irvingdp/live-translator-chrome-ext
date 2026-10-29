import { defineConfig } from '@playwright/test';

// Loads the built extension (npm run build) into Playwright's bundled Chromium.
// Installed Google Chrome ignores --load-extension, so it cannot be used here.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 30_000,
  workers: 1,
});
