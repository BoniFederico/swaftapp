import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, type Locator, type Page } from '@playwright/test';
import { launchSwaft, openDemoWorkspace, showDemoProject } from '../../e2e/launch';

const OUT = resolve(__dirname, '../../docs/assets/screenshots');
const DEBUG = !!process.env.SWAFT_SHOTS_DEBUG;

async function shot(page: Page, name: string, target?: Locator): Promise<void> {
  await page.waitForTimeout(400); // let transitions / CodeMirror settle
  if (DEBUG) console.log(`--- ${name}\n${await page.locator('body').ariaSnapshot()}`);
  await (target ?? page).screenshot({ path: join(OUT, `${name}.png`), animations: 'disabled' });
}

test('capture documentation screenshots', async () => {
  mkdirSync(OUT, { recursive: true });
  const { app, window: page } = await launchSwaft({ width: 1440, height: 900 });
  try {
    // --- Homepage (fresh profile) + the Create menu
    await page.getByRole('button', { name: 'Create workspace' }).waitFor();
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await shot(page, 'create-menu');
    await page.keyboard.press('Escape');

    // --- Open the demo, pick its project, expand every folder
    await openDemoWorkspace(app, page);
    await showDemoProject(page);
    const tree = page.getByRole('complementary', { name: 'Working Tree' });
    await shot(page, 'working-tree', tree);

    // --- Environment picker
    await page.getByRole('button', { name: 'Active environment' }).click();
    await shot(page, 'environments');
    await page.getByRole('option', { name: /Public echo/ }).click();

    // --- Document template: fill its inputs, see the rendered output
    await tree.getByText('Welcome letter', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Your name' }).fill('Ada');
    await page.getByRole('button', { name: 'Plan' }).click();
    await page.getByRole('option', { name: 'Pro' }).click();
    // The rendered output lives in a sandboxed iframe: give the render a moment instead of probing it.
    await page.waitForTimeout(1500);
    await shot(page, 'document-template');

    // --- Releases: the version picker of the open template
    await page.getByRole('main').getByRole('button', { name: 'Version' }).click();
    await shot(page, 'releases');
    await page.keyboard.press('Escape');

    // --- Template editor (double-click a template)
    await tree.getByText('Welcome letter', { exact: true }).dblclick();
    await page.getByRole('dialog', { name: 'Edit template' }).waitFor();
    await shot(page, 'template-editor');
    const editor = page.getByRole('dialog', { name: 'Edit template' });
    await editor.getByRole('button', { name: 'Cancel' }).click();
    await editor.waitFor({ state: 'detached' });

    // --- API request: send it and show the response
    await tree.getByText('Get echo', { exact: true }).click();
    await page.getByRole('tab', { name: /^Input/ }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill('Ada');
    await page.getByRole('button', { name: 'Send' }).click();
    // Live call to httpbin.org (the demo's "Public echo" environment).
    await page
      .getByTestId('api-response-body')
      .filter({ hasText: '"args"' })
      .waitFor({ state: 'attached', timeout: 30_000 });
    await shot(page, 'api-view');

    // --- Code (capability)
    await tree.getByText('greeting', { exact: true }).click();
    await shot(page, 'code-view');

    // --- Scenario canvas, then a run
    await tree.getByText('Echo flow', { exact: true }).click();
    await page.getByText('Status 200?').first().waitFor();
    await shot(page, 'scenario-canvas');
    await page.getByRole('button', { name: /^Run/ }).first().click();
    await page
      .getByText(/completed|Completed/)
      .first()
      .waitFor({ timeout: 30_000 });
    await shot(page, 'scenario-run');

    // --- Settings → Secrets
    await page.getByRole('button', { name: 'Settings' }).click();
    const settings = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('button', { name: 'Preferences', exact: true }) });
    await settings.getByRole('button', { name: 'Secrets', exact: true }).click();
    await shot(page, 'settings-secrets');
    await page.keyboard.press('Escape');
    await settings.waitFor({ state: 'detached' });

    // --- Batcher (bottom of the sidebar)
    await page
      .getByRole('region', { name: 'Batcher' })
      .getByRole('button', { name: 'Expand' })
      .click();
    await shot(page, 'batcher');

    // --- Homepage with the demo in the recent list
    await page.getByRole('button', { name: 'Back to home' }).click();
    await page.getByText('Recent workspaces').waitFor();
    await shot(page, 'homepage');
  } finally {
    await app.close();
  }
});
