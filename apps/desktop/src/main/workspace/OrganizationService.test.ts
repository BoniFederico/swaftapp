import { describe, it, expect } from 'vitest';
import { CryptoService } from '../crypto/CryptoService';
import { InProcessDbBackend } from '../storage/db-backend';
import { ChangelogService } from './ChangelogService';
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
  await ws.create({ name: 'WS', location: 'mem://o.swaft', encrypt: false });
  const org = new OrganizationService(ws);
  const templates = new TemplateService(ws, org, new ChangelogService(ws));
  return { ws, org, templates };
}

describe('OrganizationService', () => {
  it('creates projects/folders/tags and lists them in the tree', async () => {
    const { org } = await setup();
    let tree = await org.createProject({ name: 'Alpha', color: '#f00' });
    const projectId = tree.projects[0]!.id;
    tree = await org.createFolder({ name: 'Inbox', projectId });
    tree = await org.createTag({ name: 'urgent' });

    expect(tree.projects.map((p) => p.name)).toEqual(['Alpha']);
    expect(tree.projects[0]?.color).toBe('#f00');
    expect(tree.folders.map((f) => f.name)).toEqual(['Inbox']);
    expect(tree.folders[0]?.projectId).toBe(projectId);
    expect(tree.tags.map((t) => t.name)).toEqual(['urgent']);
  });

  it('stamps sync metadata and bumps revision on rename', async () => {
    const { ws, org } = await setup();
    const tree = await org.createProject({ name: 'Alpha' });
    const id = tree.projects[0]!.id;

    const created = await ws
      .requireAdapter()
      .get<{ revision: number; created_at: string; updated_by_device_id: string; deleted_at: string | null }>(
        'SELECT * FROM projects WHERE id = ?',
        [id],
      );
    expect(created?.revision).toBe(1);
    expect(created?.updated_by_device_id).toBe('dev-1');
    expect(typeof created?.created_at).toBe('string');
    expect(created?.deleted_at).toBeNull();

    await org.renameProject(id, 'Beta');
    const renamed = await ws
      .requireAdapter()
      .get<{ revision: number; name: string }>('SELECT * FROM projects WHERE id = ?', [id]);
    expect(renamed?.name).toBe('Beta');
    expect(renamed?.revision).toBe(2);
  });

  it('soft-deletes (tombstone) so the row leaves the tree but stays in the table', async () => {
    const { ws, org } = await setup();
    const project = await org.createProject({ name: 'P' });
    const tree = await org.createFolder({ name: 'Temp', projectId: project.projects[0]!.id });
    const id = tree.folders[0]!.id;

    const after = await org.deleteFolder(id);
    expect(after.folders).toHaveLength(0);

    const row = await ws
      .requireAdapter()
      .get<{ deleted_at: string | null }>('SELECT * FROM folders WHERE id = ?', [id]);
    expect(row?.deleted_at).not.toBeNull();
  });

  it('deleting a project cascades a soft-delete to its folders', async () => {
    const { org } = await setup();
    const t1 = await org.createProject({ name: 'P' });
    const projectId = t1.projects[0]!.id;
    await org.createFolder({ name: 'F1', projectId });
    const after = await org.deleteProject(projectId);
    expect(after.projects).toHaveLength(0);
    expect(after.folders).toHaveLength(0);
  });

  it('nests folders and moves folders/templates (with cycle prevention + cascade)', async () => {
    const { org, templates } = await setup();
    const tree0 = await org.createProject({ name: 'P' });
    const projectId = tree0.projects[0]!.id;
    let tree = await org.createFolder({ name: 'Parent', projectId });
    const parent = tree.folders.find((f) => f.name === 'Parent')!.id;
    tree = await org.createFolder({ name: 'Child', projectId });
    const child = tree.folders.find((f) => f.name === 'Child')!.id;

    // Nest Child under Parent.
    tree = await org.moveFolder(child, parent);
    expect(tree.folders.find((f) => f.id === child)?.parentFolderId).toBe(parent);

    // A folder cannot be moved into its own descendant.
    await expect(org.moveFolder(parent, child)).rejects.toMatchObject({ code: 'INVALID_MOVE' });

    // Move a template into Child.
    const made = await templates.createTemplate({ folderId: parent, name: 'Doc' });
    const created = made.templates.find((t) => t.name === 'Doc')!.id;
    tree = await org.moveTemplate(created, child);
    expect(tree.templates.find((t) => t.id === created)?.folderId).toBe(child);

    // Deleting Parent cascades to Child + the template under it.
    const after = await org.deleteFolder(parent);
    expect(after.folders).toHaveLength(0);
    expect(after.templates).toHaveLength(0);
  });

  it('assigns reusable tags to templates (create-on-first-use, dedupe, remove)', async () => {
    const { org, templates } = await setup();
    const tree0 = await org.createProject({ name: 'P' });
    const tree = await org.createFolder({ name: 'F', projectId: tree0.projects[0]!.id });
    const folderId = tree.folders[0]!.id;
    const a = (await templates.createTemplate({ folderId, name: 'A' })).templates.find(
      (x) => x.name === 'A',
    )!.id;
    const b = (await templates.createTemplate({ folderId, name: 'B' })).templates.find(
      (x) => x.name === 'B',
    )!.id;

    const tags = await org.addTemplateTag(a, 'urgent');
    expect(tags.map((t) => t.name)).toEqual(['urgent']);
    expect(tags[0]!.color).toBeTruthy();

    // Reuse the same tag on another template → same tag id, not duplicated.
    const tagsB = await org.addTemplateTag(b, 'urgent');
    expect(tagsB[0]!.id).toBe(tags[0]!.id);
    expect(await org.listTags()).toHaveLength(1);

    // Adding the same tag again is idempotent.
    expect(await org.addTemplateTag(a, 'urgent')).toHaveLength(1);

    // Remove from A only.
    expect(await org.removeTemplateTag(a, tags[0]!.id)).toHaveLength(0);
    expect(await org.listTemplateTags(b)).toHaveLength(1);
  });

  it('keeps a project description and exposes per-template tags + the API method in the tree', async () => {
    const { org, templates } = await setup();
    const tree0 = await org.createProject({ name: 'P', description: '  Invoices project  ' });
    const projectId = tree0.projects[0]!.id;
    expect(tree0.projects[0]!.description).toBe('Invoices project');

    const folder = (await org.createFolder({ name: 'F', projectId })).folders[0]!.id;
    const doc = (await templates.createTemplate({ folderId: folder, name: 'Doc' })).templates.find(
      (t) => t.name === 'Doc',
    )!.id;
    await templates.createTemplate({
      folderId: folder,
      name: 'Call',
      type: 'api',
      subtype: 'json',
      source: '{ "method": "post", "url": "https://x" }',
    });
    await org.addTemplateTag(doc, 'urgent');

    const tree = await org.getTree();
    const docRow = tree.templates.find((t) => t.name === 'Doc')!;
    const apiRow = tree.templates.find((t) => t.name === 'Call')!;
    expect(docRow.tagIds).toHaveLength(1);
    expect(apiRow.method).toBe('POST');
  });

  it('creates templates at the project root and moves them in/out of folders', async () => {
    const { org, templates } = await setup();
    const projectId = (await org.createProject({ name: 'P' })).projects[0]!.id;
    const folder = (await org.createFolder({ name: 'F', projectId })).folders[0]!.id;

    // Create at the project root (no folder).
    let tree = await templates.createTemplate({ projectId, name: 'RootDoc' });
    const rootDoc = tree.templates.find((t) => t.name === 'RootDoc')!;
    expect(rootDoc.folderId).toBeNull();
    expect(rootDoc.projectId).toBe(projectId);

    // Move it into the folder, then back to the root.
    tree = await org.moveTemplate(rootDoc.id, folder);
    expect(tree.templates.find((t) => t.id === rootDoc.id)!.folderId).toBe(folder);
    tree = await org.moveTemplate(rootDoc.id, null, projectId);
    const back = tree.templates.find((t) => t.id === rootDoc.id)!;
    expect(back.folderId).toBeNull();
    expect(back.projectId).toBe(projectId);

    // Deleting the project cascades to its root templates.
    const after = await org.deleteProject(projectId);
    expect(after.templates.find((t) => t.id === rootDoc.id)).toBeUndefined();
  });

  it('persists organization across close + reopen', async () => {
    const { ws, org } = await setup();
    const t = await org.createProject({ name: 'Persisted' });
    await org.createFolder({ name: 'Kept', projectId: t.projects[0]!.id });

    await ws.close();
    await ws.open({ path: 'mem://o.swaft' });

    const tree = await org.getTree();
    expect(tree.projects.map((p) => p.name)).toEqual(['Persisted']);
    expect(tree.folders.map((f) => f.name)).toEqual(['Kept']);
  });

  it('rejects organization ops when no workspace is open', async () => {
    const { ws, org } = await setup();
    await ws.close();
    await expect(org.getTree()).rejects.toMatchObject({ code: 'WORKSPACE_REQUIRED' });
  });

  it('stores folder headers/proxy/notes and persists them across reopen', async () => {
    const { ws, org } = await setup();
    let tree = await org.createProject({ name: 'P' });
    tree = await org.createFolder({ name: 'F', projectId: tree.projects[0]!.id });
    const folderId = tree.folders[0]!.id;

    // Defaults: empty policy, no notes.
    const fresh = await org.getFolder(folderId);
    expect(fresh.headers).toEqual({});
    expect(fresh.proxy).toBeNull();
    expect(fresh.notes).toBe('');

    await org.updateFolderMeta(folderId, {
      headers: { 'X-Env': 'test' },
      proxy: { protocol: 'https', hostname: 'proxy.local', port: 3128 },
      notes: '# Docs',
    });
    await ws.close();
    await ws.open({ path: 'mem://o.swaft' });

    const reloaded = await org.getFolder(folderId);
    expect(reloaded.headers).toEqual({ 'X-Env': 'test' });
    expect(reloaded.proxy).toEqual({ protocol: 'https', hostname: 'proxy.local', port: 3128 });
    expect(reloaded.notes).toBe('# Docs');

    // Clearing the proxy stores NULL again.
    await org.updateFolderMeta(folderId, { proxy: null });
    expect((await org.getFolder(folderId)).proxy).toBeNull();

    await expect(org.getFolder('nope')).rejects.toMatchObject({ code: 'FOLDER_NOT_FOUND' });
  });

  it('stores folder auth and exposes the inherited auth from the parent chain', async () => {
    const { org } = await setup();
    let tree = await org.createProject({ name: 'P' });
    const projectId = tree.projects[0]!.id;
    tree = await org.createFolder({ name: 'Parent', projectId });
    const parentId = tree.folders[0]!.id;
    tree = await org.createFolder({ name: 'Child', projectId, parentFolderId: parentId });
    const childId = tree.folders.find((f) => f.name === 'Child')!.id;

    await org.updateFolderMeta(parentId, { auth: { kind: 'bearer', token: 'T' } });

    const child = await org.getFolder(childId);
    expect(child.auth).toBeNull(); // unset = inherit
    expect(child.inheritedAuth).toMatchObject({ kind: 'bearer', token: 'T' });

    // An explicit `none` on the child stops inheritance for its own subtree previews.
    await org.updateFolderMeta(childId, { auth: { kind: 'none' } });
    expect((await org.getFolder(childId)).auth).toMatchObject({ kind: 'none' });

    // Saving `inherit` clears back to NULL (transparent).
    await org.updateFolderMeta(childId, { auth: { kind: 'inherit' } });
    expect((await org.getFolder(childId)).auth).toBeNull();
  });

  it('stores folder actions and inherits the whole chain (concatenated root→leaf)', async () => {
    const { ws, org, templates } = await setup();
    let tree = await org.createProject({ name: 'P' });
    const projectId = tree.projects[0]!.id;
    tree = await org.createFolder({ name: 'Parent', projectId });
    const parentId = tree.folders[0]!.id;
    tree = await org.createFolder({ name: 'Child', projectId, parentFolderId: parentId });
    const childId = tree.folders.find((f) => f.name === 'Child')!.id;

    // Defaults: no actions, nothing inherited.
    const fresh = await org.getFolder(parentId);
    expect(fresh.actions).toEqual([]);
    expect(fresh.inheritedActions).toEqual([]);

    await org.updateFolderMeta(parentId, {
      actions: [{ ref: 'signAll', trigger: 'pre', input: { key: 'k' }, enabled: true }],
    });
    await org.updateFolderMeta(childId, { actions: [{ ref: 'logResponse', trigger: 'post' }] });

    // The child sees the parent's action as inherited (read-only) and its own separately.
    const child = await org.getFolder(childId);
    expect(child.inheritedActions).toEqual([
      { ref: 'signAll', trigger: 'pre', input: { key: 'k' }, enabled: true },
    ]);
    expect(child.actions).toEqual([{ ref: 'logResponse', trigger: 'post' }]);

    // A template in the child folder inherits both, concatenated outermost-first.
    const created = await templates.createTemplate({
      folderId: childId,
      name: 'Call',
      source: 'x',
      type: 'api',
      subtype: 'json',
    });
    const templateId = created.templates.find((t) => t.name === 'Call')!.id;
    const policy = await org.folderPolicyOf(templateId);
    expect(policy.actions.map((a) => a.ref)).toEqual(['signAll', 'logResponse']);

    // Persists across reopen.
    await ws.close();
    await ws.open({ path: 'mem://o.swaft' });
    expect((await org.getFolder(parentId)).actions).toEqual([
      { ref: 'signAll', trigger: 'pre', input: { key: 'k' }, enabled: true },
    ]);
  });
});
