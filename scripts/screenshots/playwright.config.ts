import { defineConfig } from '@playwright/test';

// Captures the documentation screenshots (docs/assets/screenshots/*.png) by driving the built app
// through the bundled demo workspace. Run with `npm run screenshots` (it builds first).
export default defineConfig({
  testDir: '.',
  testMatch: 'capture.spec.ts',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results/screenshots',
});
