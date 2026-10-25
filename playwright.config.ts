import { defineConfig } from '@playwright/test';

// E2E tests drive the built Electron app (Playwright `_electron`).
// Build first: `npm run build`, then `npm run e2e`.
export default defineConfig({
  testDir: './e2e',
  // Generous: the first Electron launch on a cold machine (or under antivirus scanning) is slow.
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
});
