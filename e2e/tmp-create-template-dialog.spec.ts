import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

const SHOTS = String.raw`C:\Users\feder\AppData\Local\Temp\claude\c--Users-feder-OneDrive-Desktop-Repositories-swaft\6cbc236b-d158-4962-962e-70a4928032a8\scratchpad`;

test('create-template dialog shows the type picker cards', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'swaft-e2e-'));
  const baseEnv = { ...process.env, SWAFT_USER_DATA_DIR: userData };
  delete baseEnv.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [resolve(__dirname, '../apps/desktop/out/main/index.js')],
    env: baseEnv as Record<string, string>,
  });
  const window = await app.firstWindow();

  // Stub the native save dialog so the wizard's Choose… returns a temp .swaft path.
  const wsPath = join(userData, 'demo.swaft');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, wsPath);

  // Sign up
  await window.getByLabel('Username').fill('tester');
  await window.getByLabel('Password', { exact: true }).fill('longenough1');
  await window.getByLabel('Confirm password').fill('longenough1');
  await window.getByRole('button', { name: 'Create account' }).click();

  // Create a workspace
  await window.getByRole('button', { name: 'Create workspace' }).click();
  await window.getByLabel('Workspace name').fill('Demo');
  await window.getByRole('button', { name: 'Choose…' }).click();
  await expect(window.getByTestId('wizard-location')).toHaveText(wsPath);
  await window.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(window.getByLabel('Working Tree')).toBeVisible();

  // Project + folder so the Create template button appears
  await window.getByRole('button', { name: 'Select project' }).click();
  await window.getByRole('menuitem', { name: 'Create project' }).click();
  await window.getByLabel('Name').fill('Alpha');
  await window.getByRole('button', { name: 'Create', exact: true }).click();
  await window.getByRole('button', { name: 'Create folder' }).click();
  await window.getByLabel('Name').fill('Docs');
  await window.getByRole('button', { name: 'Create', exact: true }).click();
  await window.getByText('Docs').click();

  // Open the create-template dialog: the four type cards are visible, Document preselected.
  await window.getByRole('button', { name: 'Create template' }).click();
  const docCard = window.getByRole('radio', { name: 'Document' });
  await expect(docCard).toBeVisible();
  await expect(docCard).toHaveAttribute('aria-checked', 'true');
  await window.screenshot({ path: join(SHOTS, 'dialog-default.png') });

  // Selecting Capability moves the check and reveals the identifier hint.
  await window.getByRole('radio', { name: 'Capability' }).click();
  await expect(window.getByRole('radio', { name: 'Capability' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(window.getByText(/formulas and action plans reference it/)).toBeVisible();
  await window.screenshot({ path: join(SHOTS, 'dialog-capability.png') });

  await app.close();
});
