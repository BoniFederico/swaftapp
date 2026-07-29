import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GitService, GitStatus } from './GitService';
import { SystemGitService } from './GitService';
import { InProcessDbBackend } from '../storage/db-backend';
import type { SqlParam } from '../storage/sqlite';
import { CryptoService } from '../crypto/CryptoService';
import type { LocalAdapter } from '../workspace/LocalAdapter';
import { MemoryDirFs } from '../workspace/projection/dir-fs';
import { GitPersistence } from '../workspace/persistence/GitPersistence';
import { WorkspaceService } from '../workspace/WorkspaceService';
import { entityNameForPath, GitOpsService } from './GitOpsService';

describe('entityNameForPath', () => {
  const names = {
    projects: new Map([['p1', 'Billing']]),
    folders: new Map([['f1', 'Calls']]),
    tags: new Map([['t1', 'ops']]),
    environments: new Map([['e1', 'staging']]),
    templates: new Map([['tpl1', 'Release notes']]),
  };
  it('maps entity file paths to display names', () => {
    expect(entityNameForPath('projects/p1.json', names)).toBe('Billing');
    expect(entityNameForPath('folders/f1.json', names)).toBe('Calls');
    expect(entityNameForPath('environments/e1.json', names)).toBe('staging');
    expect(entityNameForPath('templates/tpl1/template.json', names)).toBe('Release notes');
    expect(entityNameForPath('templates/tpl1/source.md', names)).toBe('Release notes');
    expect(entityNameForPath('templates/tpl1/releases/r1.json', names)).toBe('Release notes');
  });
  it('returns undefined for chrome/unknown files', () => {
    expect(entityNameForPath('workspace.json', names)).toBeUndefined();
    expect(entityNameForPath('settings.json', names)).toBeUndefined();
    expect(entityNameForPath('projects/unknown.json', names)).toBeUndefined();
  });
});

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
  /** The status the next `status()` call returns (tests can override). */
  nextStatus: GitStatus = STATUS;
  /** Files present in the repo the moment `commitAll` ran (to check save-before-commit). */
  filesAtCommit: string[] = [];

  constructor(private readonly fs: MemoryDirFs) {}

  isAvailable = () => Promise.resolve(true);
  version = () => Promise.resolve('git version fake');
  isRepo = () => Promise.resolve(true);
  isEmptyRepo = () => Promise.resolve(true);
  init = () => Promise.resolve();
  status = () => Promise.resolve(this.nextStatus);
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
  showHead = () => Promise.resolve(null);
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

async function insApiTemplate(a: LocalAdapter, id: string, name: string, source: string): Promise<void> {
  const now = '2024-01-01T00:00:00.000Z';
  const row: Record<string, SqlParam> = {
    id,
    folder_id: '',
    project_id: null,
    name,
    type: 'api',
    subtype: 'json',
    source,
    has_draft: 1,
    created_at: now,
    updated_at: now,
    updated_by_device_id: 'dev',
    revision: 1,
    deleted_at: null,
  };
  const cols = Object.keys(row);
  await a.run(
    `INSERT INTO templates (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => row[c]),
  );
}

async function insEnvironment(
  a: LocalAdapter,
  id: string,
  vars: Record<string, string>,
  secretVars: string[],
): Promise<void> {
  const now = '2024-01-01T00:00:00.000Z';
  const row: Record<string, SqlParam> = {
    id,
    name: 'Prod',
    description: null,
    owner_kind: 'workspace',
    owner_id: null,
    vars: JSON.stringify(vars),
    secret_vars: JSON.stringify(secretVars),
    created_at: now,
    updated_at: now,
    updated_by_device_id: 'dev',
    revision: 1,
    deleted_at: null,
  };
  const cols = Object.keys(row);
  await a.run(
    `INSERT INTO environments (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
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
    // Hybrid naming (D2): id `p1`, name "Billing" → `billing.p1.json`.
    expect(git.filesAtCommit).toContain('projects/billing.p1.json'); // saved before the commit ran
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

  it('reports git availability', async () => {
    const { ops } = await setup();
    expect(await ops.available()).toEqual({ available: true, version: 'git version fake' });
  });

  it('reloads the store from disk on demand', async () => {
    const { fs, ws, ops } = await setup();
    const manifest = JSON.parse(fs.snapshot().get('workspace.json')!);
    await fs.writeFile('workspace.json', JSON.stringify({ ...manifest, name: 'Reloaded' }));
    await ops.reload();
    expect(ws.current()?.name).toBe('Reloaded');
  });

  it('labels changed files with the entity name', async () => {
    const { git, ws, ops } = await setup();
    await insProject(ws.requireAdapter(), 'p1', 'Billing');
    git.nextStatus = {
      ...STATUS,
      clean: false,
      files: [
        { path: 'projects/p1.json', status: 'modified', staged: false },
        { path: 'workspace.json', status: 'modified', staged: false },
      ],
    };
    const status = await ops.status();
    expect(status.files.find((f) => f.path === 'projects/p1.json')?.label).toBe('Billing');
    expect(status.files.find((f) => f.path === 'workspace.json')?.label).toBeUndefined();
  });

  it('publishes: adds origin then pushes', async () => {
    const { git, ops } = await setup();
    await ops.publish('https://example.test/acme/ws.git');
    expect(git.calls).toContain('addRemote:https://example.test/acme/ws.git');
    expect(git.calls).toContain('push');
  });

  it('rejects git ops when the open workspace is not git-backed', async () => {
    const { ws, git } = await setup();
    await ws.close();
    const ops = new GitOpsService(ws, git);
    await expect(ops.status()).rejects.toMatchObject({ code: 'GIT_WORKSPACE_REQUIRED' });
  });
});

describe('GitOpsService.commit — pre-commit secret scan (open-standards §3.4)', () => {
  const TOKEN = 'ghp_1234567890ABCDEFGHIJ';

  it('refuses to commit an api request carrying a literal secret token', async () => {
    const { git, ws, ops } = await setup();
    await insApiTemplate(
      ws.requireAdapter(),
      't1',
      'Call',
      JSON.stringify({ method: 'GET', url: 'https://api.test', headers: { Authorization: TOKEN } }),
    );

    await expect(ops.commit('add call')).rejects.toMatchObject({ code: 'SECRETS_FOUND' });
    expect(git.calls).not.toContain('commit:add call'); // refused before the commit ran
  });

  it('commits anyway when force is set, despite the same finding', async () => {
    const { git, ws, ops } = await setup();
    await insApiTemplate(
      ws.requireAdapter(),
      't1',
      'Call',
      JSON.stringify({ method: 'GET', url: 'https://api.test', headers: { Authorization: TOKEN } }),
    );

    await ops.commit('add call', true);
    expect(git.calls).toContain('commit:add call');
  });

  it('does not flag an environment variable already labeled secret (§3.3)', async () => {
    const { git, ws, ops } = await setup();
    await insEnvironment(ws.requireAdapter(), 'e1', { TOKEN }, ['TOKEN']);

    await ops.commit('add env');
    expect(git.calls).toContain('commit:add env');
  });

  it('flags a config-labeled variable holding the same kind of value', async () => {
    const { ws, ops } = await setup();
    await insEnvironment(ws.requireAdapter(), 'e1', { TOKEN }, []); // not labeled secret

    await expect(ops.commit('add env')).rejects.toMatchObject({ code: 'SECRETS_FOUND' });
  });
});

// --- Clone orchestration against the real git binary + filesystem -----------

let gitAvailable = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch {
  gitAvailable = false;
}

describe.skipIf(!gitAvailable)('GitOpsService.clone (real git)', () => {
  let root: string;
  const git = new SystemGitService();
  const backend = (bytes?: Uint8Array) => InProcessDbBackend.open(bytes);

  function makeOps(): GitOpsService {
    const ws = new WorkspaceService({
      createBackend: backend,
      crypto: new CryptoService(),
      fs: { read: () => Promise.resolve(null), write: () => Promise.resolve() },
      deviceId: () => 'dev-1',
      git: new GitPersistence({ createBackend: backend, git, deviceId: () => 'dev-1' }),
      probePath: async (p) => {
        try {
          if (!(await stat(p)).isDirectory()) return 'file';
          return existsSync(join(p, '.git')) ? 'git' : 'folder';
        } catch {
          return 'missing';
        }
      },
    });
    return new GitOpsService(ws, git);
  }

  /** An empty directory usable as a clone parent. */
  function parent(name: string): string {
    return mkdtempSync(join(root, `${name}-`));
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'swaft-cloneops-'));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('initializes a new workspace when cloning an empty repository', async () => {
    const remote = join(root, 'empty.git');
    execFileSync('git', ['init', '--bare', '--initial-branch=main', remote]);

    const summary = await makeOps().clone(remote, parent('p-empty'));

    expect(summary.storageMode).toBe('git');
    // A real workspace was scaffolded and committed into the clone (folder = repo name "empty").
    expect(existsSync(join(summary.path, 'workspace.json'))).toBe(true);
    // origin is preserved from the clone, so the first push can target the empty remote.
    expect(await git.originUrl(summary.path)).toContain('empty.git');
    expect((await git.status(summary.path)).clean).toBe(true);
  });

  it('opens an existing Swaft workspace repository (does not re-initialize)', async () => {
    // Build a workspace repo on disk to act as the clone source.
    const src = join(root, 'ws-src');
    mkdirSync(src);
    const persistence = new GitPersistence({ createBackend: backend, git, deviceId: () => 'dev-1' });
    const setup = await persistence.create({
      name: 'Shared WS',
      executionMode: 'sandbox',
      deviceId: 'dev-1',
      now: '2024-01-01T00:00:00.000Z',
      location: src,
    });
    await setup.adapter.close();

    const summary = await makeOps().clone(src, parent('p-ws'));
    expect(summary.name).toBe('Shared WS');
    expect(summary.storageMode).toBe('git');
  });

  it('produces a file diff (committed HEAD vs working tree)', async () => {
    const remote = join(root, 'diff.git');
    execFileSync('git', ['init', '--bare', '--initial-branch=main', remote]);
    const ops = makeOps();
    const summary = await ops.clone(remote, parent('p-diff'));

    const manifest = join(summary.path, 'workspace.json');
    const committed = readFileSync(manifest, 'utf8');
    writeFileSync(manifest, committed.replace(/"name":\s*"[^"]*"/, '"name": "Edited"'));

    const diff = await ops.fileDiff('workspace.json');
    expect(diff.old).toBe(committed);
    expect(diff.current).toContain('Edited');
    expect(diff.current).not.toBe(committed);

    // A path with no committed/working version yields nulls (new / deleted).
    const missing = await ops.fileDiff('does/not/exist.json');
    expect(missing.old).toBeNull();
    expect(missing.current).toBeNull();
  });

  it('rejects a non-empty repository that is not a Swaft workspace', async () => {
    const other = join(root, 'other');
    execFileSync('git', ['init', '--initial-branch=main', other]);
    execFileSync('git', ['config', 'user.email', 't@swaft.test'], { cwd: other });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: other });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: other });
    writeFileSync(join(other, 'README.md'), '# not swaft');
    execFileSync('git', ['add', '-A'], { cwd: other });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: other });

    await expect(makeOps().clone(other, parent('p-other'))).rejects.toMatchObject({
      code: 'NOT_A_SWAFT_WORKSPACE',
    });
  });
});
