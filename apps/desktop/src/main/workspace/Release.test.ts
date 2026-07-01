import { describe, it, expect } from 'vitest';
import { DRAFT_RELEASE } from '@swaft/shared';
import { CryptoService } from '../crypto/CryptoService';
import { SeeboHost } from '../seebo/SeeboHost';
import { InProcessDbBackend } from '../storage/db-backend';
import { ChangelogService } from './ChangelogService';
import { OrganizationService } from './OrganizationService';
import { ReleaseService } from './ReleaseService';
import { RenderService } from './RenderService';
import { SettingsService } from './SettingsService';
import { TemplateService } from './TemplateService';
import { WorkspaceService, type WorkspaceFs } from './WorkspaceService';

async function setup() {
  const files = new Map<string, Uint8Array>();
  const fs: WorkspaceFs = {
    read: (p) => Promise.resolve(files.get(p) ?? null),
    write: (p, b) => {
      files.set(p, b);
      return Promise.resolve();
    },
  };
  const ws = new WorkspaceService({
    createBackend: (bytes) => InProcessDbBackend.open(bytes),
    crypto: new CryptoService(),
    fs,
    deviceId: () => 'dev-1',
  });
  await ws.create({ name: 'WS', location: 'mem://r.swaft', encrypt: false });

  const org = new OrganizationService(ws);
  const settings = new SettingsService(ws);
  const changelog = new ChangelogService(ws);
  const templates = new TemplateService(ws, org, changelog);
  const releases = new ReleaseService(ws, templates, changelog);
  const render = new RenderService(ws, templates, settings, new SeeboHost(), releases);

  let tree = await org.createProject({ name: 'P' });
  tree = await org.createFolder({ name: 'F', projectId: tree.projects[0]!.id });
  const folderId = tree.folders[0]!.id;

  async function newTemplate(name: string, source: string): Promise<string> {
    const t = await templates.createTemplate({ folderId, name, source });
    return t.templates.find((x) => x.name === name)!.id;
  }

  return { templates, releases, changelog, render, newTemplate };
}

const TPL = (prefix: string) => `${prefix} \${ textbox({ id:'x', type:string() }) }`;

describe('Releases + changelog + selection (M7)', () => {
  it('creates named releases that survive draft edits', async () => {
    const { templates, releases, newTemplate } = await setup();
    const id = await newTemplate('Doc', TPL('V1'));

    let list = await releases.createRelease(id, 'First');
    expect(list.map((r) => r.name)).toEqual(['First']);
    const first = list[0]!;

    await templates.updateSource(id, TPL('V2'));
    list = await releases.createRelease(id, 'Second');
    expect(list.map((r) => r.name)).toEqual(['Second', 'First']); // newest first

    // The first snapshot is unchanged by the draft edit.
    await releases.setSelection(id, first.id);
    expect((await releases.resolveSource(id)).source).toContain('V1');
    await releases.setSelection(id, DRAFT_RELEASE);
    expect((await releases.resolveSource(id)).source).toContain('V2');
  });

  it('edits a release in place (releases are mutable)', async () => {
    const { releases, render, newTemplate } = await setup();
    const id = await newTemplate('Doc', TPL('V1'));
    const rel = (await releases.createRelease(id, 'R'))[0]!;
    await releases.setSelection(id, rel.id);
    expect((await render.render(id, { x: 'Z' })).output).toBe('V1 Z');

    await releases.updateRelease(rel.id, { source: TPL('EDITED') });
    expect((await render.render(id, { x: 'Z' })).output).toBe('EDITED Z');
  });

  it('deletes a release (logged) and stops listing it', async () => {
    const { releases, changelog, newTemplate } = await setup();
    const id = await newTemplate('Doc', TPL('V1'));
    const rel = (await releases.createRelease(id, 'Temp'))[0]!;
    expect(rel.updatedAt).toBeTruthy();

    const after = await releases.deleteRelease(rel.id);
    expect(after).toHaveLength(0);
    expect((await changelog.listEntries(id)).map((e) => e.message)).toContain(
      'Release "Temp" deleted',
    );
  });

  it('treats draft + releases as versions: deletes the draft, protects the last version', async () => {
    const { templates, releases, newTemplate } = await setup();
    const id = await newTemplate('Doc', TPL('V1'));

    // Draft only → it is the last version, cannot be deleted.
    await expect(releases.deleteDraft(id)).rejects.toMatchObject({ code: 'LAST_VERSION' });

    const rel = (await releases.createRelease(id, 'R1'))[0]!;
    await releases.deleteDraft(id);
    expect((await templates.requireTemplate(id)).hasDraft).toBe(false);
    // Effective source falls back to the release.
    expect((await releases.resolveSource(id)).source).toContain('V1');

    // Now the single remaining release is the last version → protected.
    await expect(releases.deleteRelease(rel.id)).rejects.toMatchObject({ code: 'LAST_VERSION' });
  });

  it('renders the selected release; selecting draft renders the draft', async () => {
    const { templates, releases, render, newTemplate } = await setup();
    const id = await newTemplate('Doc', TPL('V1'));
    const v1 = (await releases.createRelease(id, 'R1'))[0]!;
    await templates.updateSource(id, TPL('V2'));

    await releases.setSelection(id, v1.id);
    expect((await render.render(id, { x: 'Z' })).output).toBe('V1 Z');

    await releases.setSelection(id, DRAFT_RELEASE);
    expect((await render.render(id, { x: 'Z' })).output).toBe('V2 Z');
  });

  it('falls back to the latest release when no selection is set', async () => {
    const { releases, newTemplate } = await setup();
    const id = await newTemplate('Doc', TPL('V1'));
    const v1 = (await releases.createRelease(id, 'R1'))[0]!;
    // No explicit selection → effective selection is the latest release.
    expect(await releases.getSelection(id)).toBe(v1.id);
  });

  it('records changelog entries for releases and draft edits', async () => {
    const { templates, releases, changelog, newTemplate } = await setup();
    const id = await newTemplate('Doc', TPL('V1'));
    await releases.createRelease(id, 'First');
    await templates.updateSource(id, TPL('V2'));

    const messages = (await changelog.listEntries(id)).map((e) => e.message);
    expect(messages).toContain('Release "First" created');
    expect(messages).toContain('Draft saved');
  });
});
