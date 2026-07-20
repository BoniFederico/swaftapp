import { describe, it, expect } from 'vitest';
import { CryptoService } from '../crypto/CryptoService';
import { SeeboHost } from '../seebo/SeeboHost';
import { InProcessDbBackend } from '../storage/db-backend';
import { ChangelogService } from './ChangelogService';
import { OrganizationService } from './OrganizationService';
import { ReleaseService } from './ReleaseService';
import { RenderService } from './RenderService';
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
  await ws.create({ name: 'WS', location: 'mem://t.swaft', encrypt: false });

  const org = new OrganizationService(ws);
  const changelog = new ChangelogService(ws);
  const templates = new TemplateService(ws, org, changelog);
  const releases = new ReleaseService(ws, templates, changelog);
  const host = new SeeboHost({ now: () => new Date('2026-06-28T10:00:00Z') });
  const render = new RenderService(ws, templates, host, releases);

  let tree = await org.createProject({ name: 'P' });
  const projectId = tree.projects[0]!.id;
  tree = await org.createFolder({ name: 'F', projectId });
  const folderId = tree.folders[0]!.id;

  async function newTemplate(name: string, source?: string): Promise<string> {
    const t = await templates.createTemplate({ folderId, name, source });
    return t.templates.find((x) => x.name === name)!.id;
  }

  return { ws, org, templates, render, releases, changelog, folderId, newTemplate };
}

describe('Templates + Seebo rendering (M6)', () => {
  it('creates a document template with a renderable starter source', async () => {
    const { templates, newTemplate } = await setup();
    const id = await newTemplate('Doc');
    const t = await templates.requireTemplate(id);
    expect(t.type).toBe('document');
    expect(t.source).toContain('textbox');
  });

  it('analyze surfaces a widget per capability (textbox) with label', async () => {
    const { render, newTemplate } = await setup();
    const id = await newTemplate('Doc');
    const reqs = await render.analyze(id);
    expect(reqs).toMatchObject([
      { id: 'name', capability: 'textbox', label: 'Your name', options: null },
    ]);
    expect(reqs[0]!.type?.kind).toBe('string');
  });

  it('surfaces listbox options from type constraints', async () => {
    const { render, newTemplate } = await setup();
    const id = await newTemplate(
      'Plan',
      "${ listbox({ id:'plan', label:'Plan', type: array().constraints({ values:['Free','Pro'] }) }) }",
    );
    const reqs = await render.analyze(id);
    expect(reqs[0]).toMatchObject({ id: 'plan', capability: 'listbox', options: ['Free', 'Pro'] });
  });

  it('renders with provided values (completed) and persists the inputs', async () => {
    const { render, newTemplate } = await setup();
    const id = await newTemplate('Doc');
    const res = await render.render(id, { name: 'Ada' });
    expect(res.status).toBe('completed');
    expect(res.output).toBe('Hello Ada!');

    // Last inputs persisted (🔵 local-only).
    expect(await render.getInputState(id)).toEqual({ name: 'Ada' });
  });

  it('returns a waiting state with pending requirements when a value is missing', async () => {
    const { render, newTemplate } = await setup();
    const id = await newTemplate('Doc');
    const res = await render.render(id, {});
    expect(res.status).toBe('waiting');
    expect(res.pending.map((p) => p.id)).toContain('name');
  });

  it('updates the source and re-analyzes the new widgets', async () => {
    const { templates, render, newTemplate } = await setup();
    const id = await newTemplate('Doc');
    await templates.updateSource(id, "Qty: ${ number({ id:'qty', type:int() }) }");
    const reqs = await render.analyze(id);
    expect(reqs).toMatchObject([{ id: 'qty', capability: 'number', label: null, options: null }]);
    expect(reqs[0]!.type?.kind).toBe('int');
  });

  it('persists templates across close + reopen', async () => {
    const { ws, org, newTemplate } = await setup();
    await newTemplate('Persisted');
    await ws.close();
    await ws.open({ path: 'mem://t.swaft' });
    const tree = await org.getTree();
    expect(tree.templates.map((t) => t.name)).toEqual(['Persisted']);
  });
});
