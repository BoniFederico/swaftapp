import { test, expect } from '@playwright/test';
import { launchSwaft, openDemoWorkspace, showDemoProject } from './launch';

/**
 * E2e smoke: launch the built Electron app against a throwaway userData dir and check the two
 * entry points a new user hits — the homepage, and opening a workspace (the bundled demo). This
 * exercises the full hardened-IPC path (preload bridge, op dispatch, app store, workspace open,
 * projection read) end to end. Requires `npm run build` first.
 */
test('first run lands on the homepage', async () => {
  const { app, window } = await launchSwaft();
  try {
    // No account / sign-in: Swaft is local-first and opens straight onto the homepage.
    await expect(window.getByRole('button', { name: 'Create workspace' })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Open workspace' })).toBeVisible();
    await expect(window.getByText('Recent workspaces')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('opens the demo workspace and shows its working tree', async () => {
  const { app, window } = await launchSwaft();
  try {
    await openDemoWorkspace(app, window);
    await showDemoProject(window);
    const tree = window.getByRole('complementary', { name: 'Working Tree' });
    await expect(tree).toBeVisible();
    await expect(tree.getByText('Welcome letter')).toBeVisible();
  } finally {
    await app.close();
  }
});
