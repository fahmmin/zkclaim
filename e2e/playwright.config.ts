import { defineConfig } from '@playwright/test';

// Tests attach to 1AM test browsers you opened with `npm run e2e:open`, so they run one at a time, never headless.
export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  timeout: 10 * 60_000,
  workers: 1,
  reporter: [['list']],
});
