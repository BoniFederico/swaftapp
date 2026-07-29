import { describe, expect, it } from 'vitest';
import type { ImportedCollection } from '@swaft/shared';
import { CryptoService } from '../crypto/CryptoService';
import { InProcessDbBackend } from '../storage/db-backend';
import { ChangelogService } from './ChangelogService';
import { EnvironmentService } from './EnvironmentService';
import { ImportService } from './ImportService';
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
  const environments = new EnvironmentService(ws, () => 'me');
  const importer = new ImportService({ organization: org, templates, environments });
  return { ws, org, templates, environments, importer };
}

const collection: ImportedCollection = {
  name: 'Pet Store',
  requests: [
    { name: 'getPet', folderPath: ['Pets'], request: { method: 'GET', url: "${ env('BASE_URL') }/pets/${ id }" } },
    {
      name: 'createPet',
      folderPath: ['Pets', 'Admin'],
      request: { method: 'POST', url: "${ env('BASE_URL') }/pets", body: '{"n":"Rex"}', bodyType: 'json' },
    },
    { name: 'health', folderPath: [], request: { method: 'GET', url: "${ env('BASE_URL') }/health" } },
  ],
  environments: [{ name: 'Default', vars: { BASE_URL: 'https://api.petstore.io' } }],
};

describe('ImportService.importCollection', () => {
  it('creates a new project with nested folders and api templates', async () => {
    const { importer, org, templates } = await setup();
    const result = await importer.importCollection(collection, { kind: 'new-project' });

    expect(result).toMatchObject({ folders: 2, requests: 3, environments: 1 });

    const tree = await org.getTree();
    const project = tree.projects.find((p) => p.id === result.projectId)!;
    expect(project.name).toBe('Pet Store');

    // folder hierarchy: Pets, and Admin nested under Pets
    const pets = tree.folders.find((f) => f.name === 'Pets')!;
    const admin = tree.folders.find((f) => f.name === 'Admin')!;
    expect(pets.projectId).toBe(project.id);
    expect(admin.parentFolderId).toBe(pets.id); // Admin's parent is Pets

    // templates land in the right places, as api/json, with the request JSON as source
    const getPet = tree.templates.find((t) => t.name === 'getPet')!;
    expect(getPet.type).toBe('api');
    const full = await templates.getTemplate(getPet.id);
    expect(JSON.parse(full!.source).url).toBe("${ env('BASE_URL') }/pets/${ id }");

    // a root-path request lives at the project root (no folder)
    const health = tree.templates.find((t) => t.name === 'health')!;
    expect(health.folderId === '' || health.folderId == null).toBe(true);
  });

  it('imports environments as workspace environments', async () => {
    const { importer, environments } = await setup();
    await importer.importCollection(collection, { kind: 'new-project' });
    const envs = await environments.list();
    const def = envs.find((e) => e.name === 'Default')!;
    expect(def.ownerKind).toBe('workspace');
    const full = await environments.get(def.id);
    expect(full.vars).toEqual({ BASE_URL: 'https://api.petstore.io' });
  });

  it('imports into an existing folder additively', async () => {
    const { importer, org } = await setup();
    let tree = await org.createProject({ name: 'Existing' });
    const projectId = tree.projects[0]!.id;
    tree = await org.createFolder({ name: 'Bucket', projectId });
    const folderId = tree.folders[0]!.id;

    const result = await importer.importCollection(collection, { kind: 'folder', projectId, folderId });
    expect(result.projectId).toBe(projectId);

    const after = await org.getTree();
    // 'health' (root path) now lives directly in the target folder
    const health = after.templates.find((t) => t.name === 'health')!;
    expect(health.folderId).toBe(folderId);
  });

  describe('round-trip identity via swaftId (open-standards §3.7)', () => {
    it('updates an existing template in place instead of duplicating it', async () => {
      const { importer, org, templates } = await setup();
      const first = await importer.importCollection(collection, { kind: 'new-project' });
      const tree = await org.getTree();
      const getPetId = tree.templates.find((t) => t.name === 'getPet')!.id;

      const reimport: ImportedCollection = {
        name: 'Pet Store',
        requests: [
          {
            name: 'getPet',
            folderPath: ['Pets'],
            request: { method: 'GET', url: "${ env('BASE_URL') }/pets/${ id }/v2" },
            swaftId: getPetId,
          },
        ],
        environments: [],
      };
      const result = await importer.importCollection(reimport, {
        kind: 'project',
        projectId: first.projectId,
      });

      expect(result).toMatchObject({ requests: 0, updated: 1 });
      const after = await templates.getTemplate(getPetId);
      expect(JSON.parse(after!.source).url).toBe("${ env('BASE_URL') }/pets/${ id }/v2");
      const afterTree = await org.getTree();
      expect(afterTree.templates.filter((t) => t.name === 'getPet')).toHaveLength(1); // no duplicate
    });

    it('falls back to creating a new template when the swaftId is unknown (foreign/stale/deleted)', async () => {
      const { importer } = await setup();
      const reimport: ImportedCollection = {
        name: 'Pet Store',
        requests: [
          {
            name: 'orphan',
            folderPath: [],
            request: { method: 'GET', url: 'https://example.test' },
            swaftId: 'does-not-exist',
          },
        ],
        environments: [],
      };
      const result = await importer.importCollection(reimport, { kind: 'new-project' });
      expect(result).toMatchObject({ requests: 1, updated: 0 });
    });

    it('never overwrites a non-api template even if a crafted swaftId names it', async () => {
      const { importer, org, templates } = await setup();
      const first = await importer.importCollection(collection, { kind: 'new-project' });
      const tree = await org.getTree();
      const projectId = first.projectId;
      const treeAfterCreate = await templates.createTemplate({
        name: 'Some notes',
        type: 'document',
        projectId,
        source: '# original notes',
      });
      const noteId = treeAfterCreate.templates.find((t) => t.name === 'Some notes')!.id;
      void tree;

      const reimport: ImportedCollection = {
        name: 'Pet Store',
        requests: [
          {
            name: 'hijack',
            folderPath: [],
            request: { method: 'GET', url: 'https://evil.test' },
            swaftId: noteId, // a .bru file could claim any id by hand
          },
        ],
        environments: [],
      };
      const result = await importer.importCollection(reimport, { kind: 'project', projectId });

      expect(result).toMatchObject({ requests: 1, updated: 0 }); // created new, did not "update" the doc
      const note = await templates.getTemplate(noteId);
      expect(note!.type).toBe('document');
      expect(note!.source).toBe('# original notes'); // untouched
    });
  });
});
