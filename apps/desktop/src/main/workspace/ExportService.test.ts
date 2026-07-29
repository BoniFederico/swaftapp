import { describe, expect, it } from 'vitest';
import { CryptoService } from '../crypto/CryptoService';
import { InProcessDbBackend } from '../storage/db-backend';
import { ChangelogService } from './ChangelogService';
import { EnvironmentService } from './EnvironmentService';
import { ExportService } from './ExportService';
import { OrganizationService } from './OrganizationService';
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
  const environments = new EnvironmentService(ws);
  const exporter = new ExportService({ organization: org, templates, environments });

  let tree = await org.createProject({ name: 'Shop' });
  const projectId = tree.projects[0]!.id;
  tree = await org.createFolder({ name: 'Orders', projectId });
  const folderId = tree.folders[0]!.id;

  const apiSource = JSON.stringify({
    method: 'GET',
    url: "https://${ env('BASE') }/orders/${ id }",
    headers: { Authorization: "Bearer ${ secret('TOKEN') }" },
  });
  await templates.createTemplate({ folderId, name: 'Get order', type: 'api', subtype: 'json', source: apiSource });
  await templates.createTemplate({ folderId, name: 'Notes', type: 'document', source: 'hi' });

  return { org, templates, environments, exporter, projectId, folderId };
}

describe('ExportService.export', () => {
  it('exports a project as a Postman collection, skipping non-api templates (verbatim)', async () => {
    const { exporter, projectId } = await setup();
    const res = await exporter.export({ kind: 'project', projectId }, 'postman', 'verbatim');

    expect(res.files).toHaveLength(1);
    expect(res.files[0].path).toBe('Shop.postman_collection.json');
    const pm = JSON.parse(res.files[0].content);
    const item = pm.item[0].item[0]; // Orders / Get order
    expect(pm.item[0].name).toBe('Orders');
    expect(item.name).toBe('Get order');
    expect(item.request.url).toBe("https://${ env('BASE') }/orders/${ id }"); // verbatim
    expect(res.report.join(' ')).toMatch(/Skipped 1 document/);
  });

  it('variabilizes env/secret formulas to {{ }} when asked', async () => {
    const { exporter, projectId } = await setup();
    const res = await exporter.export({ kind: 'project', projectId }, 'postman', 'variabilize');
    const item = JSON.parse(res.files[0].content).item[0].item[0];
    expect(item.request.url).toBe('https://{{BASE}}/orders/{{id}}');
    expect(item.request.header[0].value).toBe('Bearer {{TOKEN}}');
  });

  it('exports a folder as a single .http file', async () => {
    const { exporter, folderId } = await setup();
    const res = await exporter.export({ kind: 'folder', folderId }, 'http', 'verbatim');
    expect(res.files[0].path).toBe('Orders.http');
    expect(res.files[0].content).toContain("GET https://${ env('BASE') }/orders/${ id }");
    expect(res.files[0].content).toContain('### Get order');
  });

  it('exports Bruno files under a collection directory', async () => {
    const { exporter, projectId } = await setup();
    const res = await exporter.export({ kind: 'project', projectId }, 'bruno', 'verbatim');
    const paths = res.files.map((f) => f.path);
    expect(paths).toContain('Shop/bruno.json');
    expect(paths.some((p) => p.endsWith('Get order.bru'))).toBe(true);
  });

  describe('bundled environments (open-standards §3.6)', () => {
    async function setupWithEnv() {
      const s = await setup();
      const env = await s.environments.create({ name: 'Staging', ownerKind: 'workspace' });
      await s.environments.update(env.id, {
        vars: { BASE: 'https://staging.example.test', TOKEN: 'shh' },
        secretVars: ['TOKEN'],
      });
      return { ...s, envId: env.id };
    }

    it('bundles a selected environment as a companion Postman environment file, redacting secret vars', async () => {
      const { exporter, projectId, envId } = await setupWithEnv();
      const res = await exporter.export({ kind: 'project', projectId }, 'postman', 'verbatim', [envId]);
      const envFile = res.files.find((f) => f.path === 'Staging.postman_environment.json');
      expect(envFile).toBeDefined();
      const parsed = JSON.parse(envFile!.content);
      expect(parsed.values).toEqual([{ key: 'BASE', value: 'https://staging.example.test', enabled: true }]);
      expect(res.report.join(' ')).toMatch(/1 secret-labeled variable/);
    });

    it('bundles a selected environment as a Bruno environments/*.bru file', async () => {
      const { exporter, projectId, envId } = await setupWithEnv();
      const res = await exporter.export({ kind: 'project', projectId }, 'bruno', 'verbatim', [envId]);
      const envFile = res.files.find((f) => f.path === 'Shop/environments/Staging.bru');
      expect(envFile).toBeDefined();
      expect(envFile!.content).toContain('BASE: https://staging.example.test');
      expect(envFile!.content).not.toContain('shh');
    });

    it('reports that .http export cannot bundle a selected environment', async () => {
      const { exporter, folderId, envId } = await setupWithEnv();
      const res = await exporter.export({ kind: 'folder', folderId }, 'http', 'verbatim', [envId]);
      expect(res.files).toHaveLength(1); // no companion file
      expect(res.report.join(' ')).toMatch(/not bundled/);
    });

    it('silently skips an unknown/deleted environment id', async () => {
      const { exporter, projectId } = await setupWithEnv();
      const res = await exporter.export({ kind: 'project', projectId }, 'postman', 'verbatim', ['missing']);
      expect(res.files).toHaveLength(1);
    });
  });
});
