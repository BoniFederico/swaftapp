import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const REPO = resolve(__dirname, '..');
export const MAIN_ENTRY = join(REPO, 'apps/desktop/out/main/index.js');
export const DEMO_WORKSPACE = join(REPO, 'examples/demo-workspace');

/**
 * Launch the built app (`npm run build`) against a throwaway userData dir, so a run never touches
 * (or depends on) the real profile.
 */
export async function launchSwaft(
  opts: { width?: number; height?: number } = {},
): Promise<{ app: ElectronApplication; window: Page; userData: string }> {
  const userData = mkdtempSync(join(tmpdir(), 'swaft-e2e-'));
  // Strip ELECTRON_RUN_AS_NODE (set e.g. when the runner itself lives inside an Electron host):
  // inherited, it would start the app as plain Node and the launch would fail.
  const env = { ...process.env, SWAFT_USER_DATA_DIR: userData } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [MAIN_ENTRY];
  // CI Linux runners forbid the unprivileged user namespaces Chromium's sandbox needs.
  if (process.platform === 'linux' && process.env.CI) args.unshift('--no-sandbox');
  const app = await electron.launch({ args, env });
  const window = await app.firstWindow();
  if (opts.width && opts.height) {
    const { width, height } = opts;
    await app.evaluate(
      ({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.setContentSize(size.width, size.height);
        win?.center();
      },
      { width, height },
    );
  }
  await window.waitForLoadState('domcontentloaded');
  return { app, window, userData };
}

/** Make the next native open dialog(s) "pick" `path` instead of showing a real dialog. */
export async function stubOpenDialog(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    const result = { canceled: false, filePaths: [picked] };
    dialog.showOpenDialog = (async () => result) as typeof dialog.showOpenDialog;
  }, path);
}

/** Copy the bundled demo workspace to a temp dir (never mutate the committed one) and open it. */
export async function openDemoWorkspace(app: ElectronApplication, window: Page): Promise<string> {
  const target = join(mkdtempSync(join(tmpdir(), 'swaft-demo-')), 'demo-workspace');
  cpSync(DEMO_WORKSPACE, target, { recursive: true });
  await stubOpenDialog(app, target);
  await window.getByRole('button', { name: 'Open workspace' }).click();
  await window.getByRole('menuitem', { name: 'From folder' }).click();
  await window.getByRole('complementary', { name: 'Working Tree' }).waitFor();
  return target;
}

/** Pick the demo's "Getting started" project and expand its folders so every template is listed. */
export async function showDemoProject(window: Page): Promise<void> {
  await window.getByRole('button', { name: 'Select project' }).click();
  await window.getByRole('menuitem', { name: 'Getting started' }).click();
  const tree = window.getByRole('complementary', { name: 'Working Tree' });
  for (const folder of ['Code', 'Documents', 'HTTP', 'Scenarios']) {
    await tree.getByText(folder, { exact: true }).click();
  }
  await tree.getByText('Echo flow', { exact: true }).waitFor();
  // Clicking a folder also opens it as a tab: close those again.
  const closeTab = window
    .getByRole('tablist', { name: 'Open templates' })
    .getByRole('button', { name: 'Close tab' });
  while ((await closeTab.count()) > 0) await closeTab.first().click();
}
