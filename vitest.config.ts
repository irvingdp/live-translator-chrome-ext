import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    exclude: [...configDefaults.exclude, '**/.worktrees/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html']
    }
  }
});
