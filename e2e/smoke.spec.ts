import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';

/**
 * M0 e2e smoke: launch the built Electron app and verify the window renders the shell and the
 * backend round-trip works through hardened IPC. Requires `npm run build` first.
 * Grows each milestone (sign in → workspace → template → render → API → DB → action → receipt).
 */
test('app launches, shows the shell, and pings the backend', async () => {
  const app = await electron.launch({
    args: [resolve(__dirname, '../apps/desktop/out/main/index.js')],
  });
  const window = await app.firstWindow();

  await expect(window.locator('.brand')).toContainText('Swaft');

  await window.getByRole('button', { name: 'Ping backend' }).click();
  await expect(window.getByTestId('ping-result')).toContainText('pong=true');

  await app.close();
});
