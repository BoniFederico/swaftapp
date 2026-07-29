import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GitService, GitStatus } from '../../git/GitService';
import { SystemGitService } from '../../git/GitService';
import { InProcessDbBackend } from '../../storage/db-backend';
import type { SqlParam } from '../../storage/sqlite';
import type { LocalAdapter } from '../LocalAdapter';
import { MemoryDirFs } from '../projection/dir-fs';
import { GitPersistence } from './GitPersistence';

const CLEAN: GitStatus = {
  branch: 'main',
  detached: false,
  hasUpstream: false,
  ahead: 0,
  behind: 0,
  clean: true,
  files: [],
};

/** Records the git commands invoked, so tests can assert the create/commit orchestration. */
class FakeGit implements GitService {
  readonly calls: string[] = [];
  isAvailable = () => Promise.resolve(true);
  version = () => Promise.resolve('git version fake');
  isRepo = () => Promise.resolve(true);
  isEmptyRepo = () => Promise.resolve(false);
  init = () => (this.calls.push('init'), Promise.resolve());
  status = () => Promise.resolve(CLEAN);
  currentBranch = () => Promise.resolve('main');
  listBranches = () => Promise.resolve(['main']);
  createBranch = () => Promise.resolve();
  checkout = () => Promise.resolve();
  commitAll = (_dir: string, message: string) => (this.calls.push(`commit:${message}`), Promise.resolve());
  fetch = () => Promise.resolve();
  pull = () => Promise.resolve();
  push = () => Promise.resolve();
  discardAll = () => Promise.resolve();
  clone = (_url: string, parentDir: string) => Promise.resolve(`${parentDir}/repo`);
  originUrl = () => Promise.resolve(null);
  addRemote = () => Promise.resolve();
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

describe('GitPersistence (in-memory)', () => {
  function make() {
    const fs = new MemoryDirFs();
    const git = new FakeGit();
    const persistence = new GitPersistence({
      createBackend: (bytes) => InProcessDbBackend.open(bytes),
      git,
      deviceId: () => 'dev-1',
      now: () => '2024-01-01T00:00:00.000Z',
      dirFs: () => fs,
    });
    return { fs, git, persistence };
  }

  it('creates a repo workspace: inits, scaffolds, dumps and makes the first commit', async () => {
    const { fs, git, persistence } = make();
    const opened = await persistence.create({
      name: 'Repo WS',
      executionMode: 'sandbox',
      deviceId: 'dev-1',
      now: '2024-01-01T00:00:00.000Z',
      location: '/repo',
    });

    expect(opened.encrypted).toBe(false);
    const files = fs.snapshot();
    expect(files.has('workspace.json')).toBe(true);
    expect(files.has('.gitignore')).toBe(true);
    expect(files.has('.gitattributes')).toBe(true);
    expect(git.calls).toEqual(['init', 'commit:Initialize Swaft workspace']);
    await opened.adapter.close();
  });

  it('round-trips content through save → open', async () => {
    const { persistence } = make();
    const created = await persistence.create({
      name: 'Repo WS',
      executionMode: 'sandbox',
      deviceId: 'dev-1',
      now: '2024-01-01T00:00:00.000Z',
      location: '/repo',
    });
    await insProject(created.adapter, 'p1', 'Billing');
    await persistence.save(created.adapter, '/repo');
    await created.adapter.close();

    const reopened = await persistence.open({ location: '/repo' });
    const meta = await reopened.adapter.getMeta();
    expect(meta?.name).toBe('Repo WS');
    expect(meta?.storage_mode).toBe('git');
    const projects = await reopened.adapter.all('SELECT name FROM projects WHERE deleted_at IS NULL');
    expect(projects).toEqual([{ name: 'Billing' }]);
    await reopened.adapter.close();
  });

  it('rejects opening a directory that is not a Swaft workspace', async () => {
    const { persistence } = make();
    await expect(persistence.open({ location: '/empty' })).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_FOUND',
    });
  });

  it('carries 🔵 local-only tables across save → open via the git-ignored /.swaft/ cache (§3.5)', async () => {
    const { fs, persistence } = make();
    const created = await persistence.create({
      name: 'Repo WS',
      executionMode: 'sandbox',
      deviceId: 'dev-1',
      now: '2024-01-01T00:00:00.000Z',
      location: '/repo',
    });
    await created.adapter.run(
      `INSERT INTO api_history (id, template_id, method, url, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ['h1', 'tpl-1', 'GET', 'https://example.test', 200, '2024-01-01T00:00:00.000Z'],
    );
    await persistence.save(created.adapter, '/repo');
    await created.adapter.close();

    expect(fs.snapshot().has('.swaft/local-cache.json')).toBe(true);

    const reopened = await persistence.open({ location: '/repo' });
    const history = await reopened.adapter.all('SELECT template_id, method, url, status FROM api_history');
    expect(history).toEqual([{ template_id: 'tpl-1', method: 'GET', url: 'https://example.test', status: 200 }]);
    await reopened.adapter.close();
  });
});

// --- Integration through the real git binary + real filesystem --------------

let gitAvailable = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch {
  gitAvailable = false;
}

describe.skipIf(!gitAvailable)('GitPersistence (real git)', () => {
  const git = new SystemGitService();
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'swaft-gitp-'));
    // Pre-init so we can set a local identity; GitPersistence.create then no-ops the init and commits.
    execFileSync('git', ['init'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@swaft.test'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Swaft Test'], { cwd: dir });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('creates a committed workspace on disk and reopens it', async () => {
    const persistence = new GitPersistence({
      createBackend: (bytes) => InProcessDbBackend.open(bytes),
      git,
      deviceId: () => 'dev-1',
    });
    const created = await persistence.create({
      name: 'On Disk',
      executionMode: 'sandbox',
      deviceId: 'dev-1',
      now: '2024-01-01T00:00:00.000Z',
      location: dir,
    });
    await insProject(created.adapter, 'p1', 'Infra');
    await persistence.save(created.adapter, dir);
    await git.commitAll(dir, 'add project');
    await created.adapter.close();

    // The tree is clean and the workspace files are tracked.
    expect((await git.status(dir)).clean).toBe(true);
    const tracked = execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' });
    expect(tracked).toMatch(/workspace\.json/);
    // Hybrid naming (D2): `<slug>.<shortId>.json` — id `p1`, name "Infra" → `infra.p1.json`.
    expect(tracked).toMatch(/projects\/infra\.p1\.json/);
    // §3.5: the local-only cache is written to disk but stays git-ignored, never tracked.
    expect(existsSync(join(dir, '.swaft/local-cache.json'))).toBe(true);
    expect(tracked).not.toMatch(/\.swaft/);

    const reopened = await persistence.open({ location: dir });
    expect((await reopened.adapter.getMeta())?.name).toBe('On Disk');
    const projects = await reopened.adapter.all('SELECT name FROM projects WHERE deleted_at IS NULL');
    expect(projects).toEqual([{ name: 'Infra' }]);
    await reopened.adapter.close();
  });
});
