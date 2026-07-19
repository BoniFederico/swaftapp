import { describe, it, expect } from 'vitest';
import type { TemplateType } from '@swaft/shared';
import { ActionService } from '../actions/ActionService';
import { CryptoService } from '../crypto/CryptoService';
import { SeeboHost } from '../seebo/SeeboHost';
import { InProcessDbBackend } from '../storage/db-backend';
import { BatcherService } from './BatcherService';
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
  await ws.create({ name: 'WS', location: 'mem://m10.swaft', encrypt: false });

  const org = new OrganizationService(ws);
  const settings = new SettingsService(ws);
  const changelog = new ChangelogService(ws);
  const templates = new TemplateService(ws, org, changelog);
  const releases = new ReleaseService(ws, templates, changelog);
  const host = new SeeboHost();
  const render = new RenderService(ws, templates, host, releases);
  const batcher = new BatcherService(templates, releases, host);
  const actions = new ActionService(ws, {
    host,
    releases,
    render,
    settings,
    currentUsername: () => 'tester',
  });

  let tree = await org.createProject({ name: 'P' });
  tree = await org.createFolder({ name: 'F', projectId: tree.projects[0]!.id });
  const folderId = tree.folders[0]!.id;

  async function newTemplate(
    name: string,
    source: string,
    type: TemplateType = 'document',
  ): Promise<string> {
    const t = await templates.createTemplate({ folderId, name, source, type });
    return t.templates.find((x) => x.name === name)!.id;
  }

  return { batcher, actions, render, newTemplate };
}

/** A document declaring one confirm-gated `log` action with a literal input. */
const actionTpl = (value: string) =>
  `start \${ action({ id:'mk', type:'log', input:{ secret:'${value}' }, confirm:true, environment:'test' }) }`;

describe('Batcher (M10)', () => {
  it('composes ordered document templates and shares input ids once', async () => {
    const { batcher, newTemplate } = await setup();
    const a = await newTemplate('A', "A:${ textbox({ id:'name', type:string() }) }");
    const b = await newTemplate('B', "B:${ textbox({ id:'name', type:string() }) }");

    const reqs = await batcher.analyze([a, b]);
    expect(reqs.map((r) => r.id)).toEqual(['name']);

    const result = await batcher.render([a, b], { name: 'Ada' });
    expect(result.status).toBe('completed');
    expect(result.output).toContain('A:Ada');
    expect(result.output).toContain('B:Ada');
  });

  it('rejects non-document templates (document-only, fail-closed)', async () => {
    const { batcher, newTemplate } = await setup();
    const api = await newTemplate('Api', 'x', 'api');
    await expect(batcher.render([api], {})).rejects.toMatchObject({ code: 'BATCH_DOCUMENT_ONLY' });
  });
});

describe('ActionService (M10, seebo/actions bridge)', () => {
  it('surfaces prepared actions on the render result', async () => {
    const { newTemplate, render } = await setup();
    const id = await newTemplate('Act', actionTpl('hi'));
    const result = await render.render(id, {});
    expect(result.actions.map((a) => a.type)).toEqual(['log']);
    expect(result.actions[0]!.requiresConfirmation).toBe(true);
  });

  it('never executes a confirm-gated action until it is confirmed', async () => {
    const { actions, newTemplate } = await setup();
    const id = await newTemplate('Act', actionTpl('hi'));

    const skipped = await actions.execute(id, { confirmedActions: [], failFast: true });
    expect(skipped[0]!.status).toBe('skipped');

    const ok = await actions.execute(id, { confirmedActions: ['mk'], failFast: true });
    expect(ok[0]!.status).toBe('succeeded');
  });

  it('persists redacted receipts (never the action input values)', async () => {
    const { actions, newTemplate } = await setup();
    const id = await newTemplate('Act', actionTpl('s3cr3t'));
    await actions.execute(id, { confirmedActions: ['mk'], failFast: true });
    const receipts = await actions.list(id);
    expect(receipts).toHaveLength(1);
    expect(JSON.stringify(receipts)).not.toContain('s3cr3t');
  });
});
