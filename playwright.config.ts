import { defineConfig } from '@playwright/test';

// E2E tests drive the built Electron app (Playwright `_electron`).
// Build first: `npm run build`, then `npm run e2e`.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
});
