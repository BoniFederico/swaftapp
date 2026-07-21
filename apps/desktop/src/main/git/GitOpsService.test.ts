import { describe, expect, it } from 'vitest';
import type { GitService, GitStatus } from './GitService';
import { InProcessDbBackend } from '../storage/db-backend';
import type { SqlParam } from '../storage/sqlite';
import { CryptoService } from '../crypto/CryptoService';
import type { LocalAdapter } from '../workspace/LocalAdapter';
import { MemoryDirFs } from '../workspace/projection/dir-fs';
import { GitPersistence } from '../workspace/persistence/GitPersistence';
import { WorkspaceService } from '../workspace/WorkspaceService';
import { GitOpsService } from './GitOpsService';

const STATUS: GitStatus = {
  branch: 'main',
  detached: false,
  hasUpstream: true,
  ahead: 0,
  behind: 0,
  clean: true,
  files: [],
};

/** A scriptable fake git: records calls, and lets tests hook `pull` to mutate the working tree. */
class FakeGit implements GitService {
  readonly calls: string[] = [];
  onPull: (() => void) | undefined;
  /** Files present in the repo the moment `commitAll` ran (to check save-before-commit). */
  filesAtCommit: string[] = [];

  constructor(private readonly fs: MemoryDirFs) {}

  isAvailable = () => Promise.resolve(true);
  version = () => Promise.resolve('git version fake');
  isRepo = () => Promise.resolve(true);
  init = () => Promise.resolve();
  status = () => Promise.resolve(STATUS);
  currentBranch = () => Promise.resolve('main');
  listBranches = () => Promise.resolve(['main', 'dev']);
  createBranch = (_d: string, n: string) => (this.calls.push(`createBranch:${n}`), Promise.resolve());
  checkout = (_d: string, b: string) => (this.calls.push(`checkout:${b}`), Promise.resolve());
  commitAll = (_d: string, m: string) => {
    this.filesAtCommit = [...this.fs.snapshot().keys()];
    this.calls.push(`commit:${m}`);
    return Promise.resolve();
  };
  fetch = () => (this.calls.push('fetch'), Promise.resolve());
  pull = () => {
    this.calls.push('pull');
    this.onPull?.();
    return Promise.resolve();
  };
  push = () => (this.calls.push('push'), Promise.resolve());
  discardAll = () => (this.calls.push('discard'), Promise.resolve());
  clone = (_url: string, parentDir: string) => (this.calls.push('clone'), Promise.resolve(`${parentDir}/repo`));
  originUrl = () => Promise.resolve(null);
  addRemote = (_dir: string, _name: string, url: string) => (
    this.calls.push(`addRemote:${url}`), Promise.resolve()
  );
}

async function insProject(a: LocalAdapter, id: string, name: string): Promise<void> {
  const now = '2024-01-01T00:00:00.000Z';
  const row: Record<string, SqlParam> = {
    id,
    name,
    color: null,
    description: null,
    created_at: now,
    updated_at: now,
    updated_by_device_id: 'dev',
    revision: 1,
    deleted_at: null,
  };
  const cols = Object.keys(row);
  await a.run(
    `INSERT INTO projects (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => row[c]),
  );
}

async function setup() {
  const fs = new MemoryDirFs();
  const git = new FakeGit(fs);
  const ws = new WorkspaceService({
    createBackend: (bytes) => InProcessDbBackend.open(bytes),
    crypto: new CryptoService(),
    fs: { read: () => Promise.resolve(null), write: () => Promise.resolve() },
    deviceId: () => 'dev-1',
    git: new GitPersistence({
      createBackend: (bytes) => InProcessDbBackend.open(bytes),
      git,
      deviceId: () => 'dev-1',
      now: () => '2024-01-01T00:00:00.000Z',
      dirFs: () => fs,
    }),
  });
  await ws.create({ name: 'Repo WS', location: '/repo', storageMode: 'git', encrypt: false });
  const ops = new GitOpsService(ws, git);
  return { fs, git, ws, ops };
}

describe('GitOpsService', () => {
  it('reports status with the branch list', async () => {
    const { ops } = await setup();
    const status = await ops.status();
    expect(status.branch).toBe('main');
    expect(status.branches).toEqual(['main', 'dev']);
    expect(status.clean).toBe(true);
  });

  it('flushes pending edits to the working tree before committing', async () => {
    const { git, ws, ops } = await setup();
    // Mutate the in-memory store WITHOUT saving; commit must persist it first. (create() already
    // made the initial commit, so p1 is only on disk if commit's save() ran before commitAll.)
    await insProject(ws.requireAdapter(), 'p1', 'Billing');

    await ops.commit('add billing');

    expect(git.calls).toContain('commit:add billing');
    expect(git.filesAtCommit).toContain('projects/p1.json'); // saved before the commit ran
  });

  it('reloads the in-memory store after a pull that changed files on disk', async () => {
    const { fs, git, ws, ops } = await setup();
    expect(ws.current()?.name).toBe('Repo WS');

    // Simulate the remote having renamed the workspace: the pull rewrites the manifest on disk.
    git.onPull = () => {
      const manifest = JSON.parse(fs.snapshot().get('workspace.json')!);
      void fs.writeFile('workspace.json', JSON.stringify({ ...manifest, name: 'Pulled Name' }));
    };
    await ops.pull();

    expect(git.calls).toContain('pull');
    expect(ws.current()?.name).toBe('Pulled Name'); // reload picked up the new manifest
  });

  it('checks out a branch and reloads', async () => {
    const { git, ops } = await setup();
    await ops.checkout('dev');
    expect(git.calls).toContain('checkout:dev');
  });

  it('publishes: adds origin then pushes', async () => {
    const { git, ops } = await setup();
    await ops.publish('https://example.test/acme/ws.git');
    expect(git.calls).toContain('addRemote:https://example.test/acme/ws.git');
    expect(git.calls).toContain('push');
  });

  it('clones without needing an open workspace', async () => {
    const { git, ops } = await setup();
    const path = await ops.clone('https://example.test/acme/ws.git', '/parent');
    expect(path).toBe('/parent/repo');
    expect(git.calls).toContain('clone');
  });

  it('rejects git ops when the open workspace is not git-backed', async () => {
    const { ws, git } = await setup();
    await ws.close();
    const ops = new GitOpsService(ws, git);
    await expect(ops.status()).rejects.toMatchObject({ code: 'GIT_WORKSPACE_REQUIRED' });
  });
});
