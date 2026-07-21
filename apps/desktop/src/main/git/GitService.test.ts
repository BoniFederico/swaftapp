import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deriveRepoName, parseStatus, SystemGitService } from './GitService';

describe('deriveRepoName', () => {
  it('extracts the repo folder name from clone URLs', () => {
    expect(deriveRepoName('https://github.com/acme/widgets.git')).toBe('widgets');
    expect(deriveRepoName('https://github.com/acme/widgets')).toBe('widgets');
    expect(deriveRepoName('git@github.com:acme/widgets.git')).toBe('widgets');
    expect(deriveRepoName('https://git-codecommit.eu-west-1.amazonaws.com/v1/repos/ops/')).toBe('ops');
  });
});

describe('parseStatus', () => {
  it('reads branch, upstream and ahead/behind', () => {
    const s = parseStatus('## main...origin/main [ahead 1, behind 2]\n');
    expect(s.branch).toBe('main');
    expect(s.hasUpstream).toBe(true);
    expect(s.ahead).toBe(1);
    expect(s.behind).toBe(2);
    expect(s.clean).toBe(true);
  });

  it('handles no-upstream and pre-first-commit branch lines', () => {
    expect(parseStatus('## main\n').branch).toBe('main');
    expect(parseStatus('## main\n').hasUpstream).toBe(false);
    expect(parseStatus('## No commits yet on main\n').branch).toBe('main');
  });

  it('flags a detached HEAD', () => {
    const s = parseStatus('## HEAD (no branch)\n');
    expect(s.detached).toBe(true);
    expect(s.branch).toBeNull();
  });

  it('keeps the new path for a rename entry', () => {
    const s = parseStatus('## main\nR  old/name.json -> new/name.json\n');
    expect(s.files).toEqual([{ path: 'new/name.json', status: 'renamed', staged: true }]);
  });

  it('classifies file changes and staged state', () => {
    const s = parseStatus(
      ['## main', ' M modified.txt', 'A  staged-add.txt', '?? new.txt', 'UU conflict.txt', ' D gone.txt'].join(
        '\n',
      ),
    );
    expect(s.clean).toBe(false);
    expect(s.files).toEqual([
      { path: 'modified.txt', status: 'modified', staged: false },
      { path: 'staged-add.txt', status: 'added', staged: true },
      { path: 'new.txt', status: 'untracked', staged: false },
      { path: 'conflict.txt', status: 'conflicted', staged: false },
      { path: 'gone.txt', status: 'deleted', staged: false },
    ]);
  });
});

// --- Integration: exercises the real `git` binary in a temp repo ------------

let gitAvailable = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch {
  gitAvailable = false;
}

describe.skipIf(!gitAvailable)('SystemGitService (integration)', () => {
  const svc = new SystemGitService();
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'swaft-git-'));
    execFileSync('git', ['init'], { cwd: dir });
    // Local identity so commits work regardless of the machine's global git config.
    execFileSync('git', ['config', 'user.email', 'test@swaft.test'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Swaft Test'], { cwd: dir });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports availability and repo detection', async () => {
    expect(await svc.isAvailable()).toBe(true);
    expect(await svc.version()).toMatch(/git version/);
    expect(await svc.isRepo(dir)).toBe(true);
    expect(await svc.isRepo(tmpdir())).toBe(false);
  });

  it('sees untracked files, then a clean tree after commit', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello');
    const before = await svc.status(dir);
    expect(before.clean).toBe(false);
    expect(before.files.some((f) => f.path === 'a.txt' && f.status === 'untracked')).toBe(true);

    await svc.commitAll(dir, 'initial commit');
    const after = await svc.status(dir);
    expect(after.clean).toBe(true);
    expect(after.branch).not.toBeNull();
  });

  it('creates and switches branches', async () => {
    const start = (await svc.currentBranch(dir))!;
    await svc.createBranch(dir, 'feature/x');
    expect(await svc.currentBranch(dir)).toBe('feature/x');

    const branches = await svc.listBranches(dir);
    expect(branches).toContain('feature/x');
    expect(branches).toContain(start);

    await svc.checkout(dir, start);
    expect(await svc.currentBranch(dir)).toBe(start);
  });

  it('discards uncommitted changes (tracked reverted, untracked removed)', async () => {
    writeFileSync(join(dir, 'a.txt'), 'changed');
    writeFileSync(join(dir, 'untracked.txt'), 'temp');
    expect((await svc.status(dir)).clean).toBe(false);

    await svc.discardAll(dir);
    const after = await svc.status(dir);
    expect(after.clean).toBe(true);
  });

  it('rejects unsafe branch names', async () => {
    await expect(svc.createBranch(dir, '-rf')).rejects.toMatchObject({ code: 'GIT_INVALID_REF' });
    await expect(svc.checkout(dir, 'a b')).rejects.toMatchObject({ code: 'GIT_INVALID_REF' });
  });

  it('adds a remote, first-pushes setting upstream, and clones back', async () => {
    const base = mkdtempSync(join(tmpdir(), 'swaft-remote-'));
    const work = join(base, 'work');
    mkdirSync(work);
    execFileSync('git', ['init'], { cwd: work });
    execFileSync('git', ['config', 'user.email', 'test@swaft.test'], { cwd: work });
    execFileSync('git', ['config', 'user.name', 'Swaft Test'], { cwd: work });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: work });
    writeFileSync(join(work, 'f.txt'), 'hello');
    await svc.commitAll(work, 'init');

    expect(await svc.originUrl(work)).toBeNull();

    const bare = join(base, 'origin.git');
    execFileSync('git', ['init', '--bare', bare]);
    await svc.addRemote(work, 'origin', bare);
    expect(await svc.originUrl(work)).toContain('origin.git');

    // No upstream yet → push must set it (push -u origin <branch>).
    expect((await svc.status(work)).hasUpstream).toBe(false);
    await svc.push(work);
    expect((await svc.status(work)).hasUpstream).toBe(true);

    // Clone the bare repo elsewhere; the committed file comes across.
    const dest = mkdtempSync(join(tmpdir(), 'swaft-clone-'));
    const cloned = await svc.clone(bare, dest);
    expect(existsSync(join(cloned, 'f.txt'))).toBe(true);

    rmSync(base, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  });

  it('push without a remote fails with a clear code', async () => {
    const solo = mkdtempSync(join(tmpdir(), 'swaft-solo-'));
    execFileSync('git', ['init'], { cwd: solo });
    execFileSync('git', ['config', 'user.email', 'test@swaft.test'], { cwd: solo });
    execFileSync('git', ['config', 'user.name', 'Swaft Test'], { cwd: solo });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: solo });
    writeFileSync(join(solo, 'a.txt'), 'x');
    await svc.commitAll(solo, 'init');
    await expect(svc.push(solo)).rejects.toMatchObject({ code: 'GIT_NO_REMOTE' });
    rmSync(solo, { recursive: true, force: true });
  });
});
