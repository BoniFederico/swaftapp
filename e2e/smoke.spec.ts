import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

/**
 * E2e smoke: launch the built Electron app against a throwaway userData dir, create the local
 * account through the real sign-up gate, and land on the homepage. This exercises the full
 * hardened-IPC path (auth ops, safeStorage, app store) end to end. Requires `npm run build` first.
 */
test('first run: sign up locally and land on the homepage', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'swaft-e2e-'));
  // Strip ELECTRON_RUN_AS_NODE (set e.g. when the runner itself lives inside an Electron host):
  // inherited, it would start the app as plain Node and the launch would fail.
  const { ELECTRON_RUN_AS_NODE: _ignored, ...baseEnv } = process.env;
  const app = await electron.launch({
    args: [resolve(__dirname, '../apps/desktop/out/main/index.js')],
    env: { ...baseEnv, SWAFT_USER_DATA_DIR: userData } as Record<string, string>,
  });
  const window = await app.firstWindow();

  // Unauthenticated gate: a fresh profile offers account creation.
  await expect(window.getByText('Create your account')).toBeVisible();
  await window.getByLabel('Username').fill('tester');
  await window.getByLabel('Password', { exact: true }).fill('longenough1');
  await window.getByLabel('Confirm password').fill('longenough1');
  await window.getByRole('button', { name: 'Create account' }).click();

  // Signed in → homepage with the workspace actions and the (empty) recent list.
  await expect(window.getByRole('button', { name: 'Create workspace' })).toBeVisible();
  await expect(window.getByText('Recent workspaces')).toBeVisible();

  await app.close();
});
