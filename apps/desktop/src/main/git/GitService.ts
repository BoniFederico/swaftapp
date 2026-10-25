import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppError } from '../errors';

const run = promisify(execFile);

/** A single changed path in the working tree (staged and/or unstaged). */
export interface GitFileChange {
  path: string;
  /** Coarse change kind, derived from the porcelain XY code. */
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
  /** True when the change is staged in the index. */
  staged: boolean;
}

/** A structured view of `git status`, tailored to the small in-app Git panel. */
export interface GitStatus {
  /** Current branch name, or null when detached / before the first commit resolves one. */
  branch: string | null;
  detached: boolean;
  /** Whether an upstream is configured for the current branch. */
  hasUpstream: boolean;
  ahead: number;
  behind: number;
  clean: boolean;
  files: GitFileChange[];
}

/**
 * Git operations for the `git` storage mode, implemented by **shelling out to the user's installed
 * `git` binary** from the trusted main process. This deliberately reuses the user's
 * SSH keys, credential helpers and git config, needs nothing installed via npm (offline-friendly),
 * and — being in main, not sandboxed user code — is consistent with the security model. Commands run
 * through `execFile` (no shell), so arguments are never word-split or interpolated.
 *
 * Methods take the repo directory as `cwd`; the service is otherwise stateless. `isAvailable`/`isRepo`
 * never throw (they answer a question); the mutating/reading commands throw a coded {@link AppError}
 * carrying git's stderr on failure.
 */
export interface GitService {
  /** Whether a usable `git` binary is on PATH. Never throws. */
  isAvailable(): Promise<boolean>;
  /** The `git --version` string, or null when git is unavailable. */
  version(): Promise<string | null>;
  /** Whether `dir` is inside a git work tree. Never throws. */
  isRepo(dir: string): Promise<boolean>;
  /** Whether the repo has no commits yet (e.g. a freshly cloned empty remote). Never throws. */
  isEmptyRepo(dir: string): Promise<boolean>;
  /** Initialize a new repository at `dir` (no-op if already one). */
  init(dir: string): Promise<void>;
  status(dir: string): Promise<GitStatus>;
  currentBranch(dir: string): Promise<string | null>;
  listBranches(dir: string): Promise<string[]>;
  /** Create a branch from HEAD and switch to it. */
  createBranch(dir: string, name: string): Promise<void>;
  checkout(dir: string, branch: string): Promise<void>;
  /** Stage everything and commit; relies on the user's configured git identity. */
  commitAll(dir: string, message: string): Promise<void>;
  fetch(dir: string): Promise<void>;
  pull(dir: string): Promise<void>;
  /**
   * Push the current branch. If it has no upstream yet, set it to `origin` on first push
   * (`push -u origin <branch>`); throws when no remote is configured.
   */
  push(dir: string): Promise<void>;
  /** Discard all uncommitted changes: restore tracked files to HEAD and remove untracked ones. */
  discardAll(dir: string): Promise<void>;
  /** Clone `url` into a new subdirectory of `parentDir`; returns the created repo path. */
  clone(url: string, parentDir: string): Promise<string>;
  /** The `origin` remote URL, or null when no `origin` remote is configured. */
  originUrl(dir: string): Promise<string | null>;
  /** Add a remote (e.g. `origin`) pointing at `url`. */
  addRemote(dir: string, name: string, url: string): Promise<void>;
  /** The committed (HEAD) contents of a tracked file, or null when it is new / has no HEAD. */
  showHead(dir: string, path: string): Promise<string | null>;
}

/** Reject refs/messages that could be mistaken for options or break the ref grammar. */
function assertSafeRef(name: string): void {
  if (!name || name.startsWith('-') || /[\s~^:?*[\\]/.test(name) || name.includes('..')) {
    throw new AppError('GIT_INVALID_REF', 'validation', `Invalid git branch name: "${name}".`);
  }
}

/** Reject a URL/remote-name that could be parsed as an option (defense for the arg-based CLI). */
function assertSafeArg(value: string, code: string, label: string): void {
  if (!value || value.startsWith('-')) {
    throw new AppError(code, 'validation', `Invalid ${label}: "${value}".`);
  }
}

/** Upper bound for a single git invocation (clones of large repos included). */
const GIT_TIMEOUT_MS = 10 * 60 * 1000;

/** Map a failed git invocation to a coded error, with friendlier messages for common setup issues. */
export function gitError(err: unknown, args: string[]): AppError {
  const e = err as { stderr?: string; killed?: boolean; signal?: string | null; message?: string };
  if (e.killed && e.signal) {
    return new AppError(
      'GIT_TIMEOUT',
      'execution',
      `git ${args[0] ?? ''} did not finish within ${GIT_TIMEOUT_MS / 60000} minutes and was stopped. Check your network and credentials.`,
      { args },
    );
  }
  const stderr = e.stderr?.trim();
  if (stderr && /please tell me who you are|unable to auto-detect email address/i.test(stderr)) {
    return new AppError(
      'GIT_IDENTITY_MISSING',
      'validation',
      'Git does not know who you are yet. Run `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`, then try again.',
      { args },
    );
  }
  if (stderr && /terminal prompts disabled|could not read username/i.test(stderr)) {
    return new AppError(
      'GIT_AUTH_REQUIRED',
      'execution',
      'The remote asked for credentials. Configure a credential helper (e.g. Git Credential Manager) or use an SSH remote with a key loaded in your agent.',
      { args },
    );
  }
  return new AppError('GIT_COMMAND_FAILED', 'execution', stderr || e.message || 'git command failed', { args });
}

/** Derive the directory name `git clone` would create for a URL (last path segment, sans `.git`). */
export function deriveRepoName(url: string): string {
  const cleaned = url.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  const segment = cleaned.split(/[/:]/).pop() ?? '';
  return segment.replace(/[^A-Za-z0-9._-]/g, '') || 'repo';
}

export class SystemGitService implements GitService {
  private availability: Promise<boolean> | undefined;

  /** Run a git command, mapping a non-zero exit to a coded error carrying git's stderr. */
  private async git(cwd: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await run('git', args, {
        cwd,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        // There is no terminal to answer a credential prompt: fail fast instead of hanging forever
        // (GUI credential helpers such as Git Credential Manager keep working).
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        // Last-resort bound for anything else that blocks (e.g. an unanswerable SSH prompt).
        timeout: GIT_TIMEOUT_MS,
      });
      return stdout;
    } catch (err) {
      throw gitError(err, args);
    }
  }

  isAvailable(): Promise<boolean> {
    if (!this.availability) {
      this.availability = run('git', ['--version'], { windowsHide: true })
        .then(() => true)
        .catch(() => false);
    }
    return this.availability;
  }

  async version(): Promise<string | null> {
    try {
      const { stdout } = await run('git', ['--version'], { windowsHide: true });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async isRepo(dir: string): Promise<boolean> {
    try {
      const out = await this.git(dir, ['rev-parse', '--is-inside-work-tree']);
      return out.trim() === 'true';
    } catch {
      return false;
    }
  }

  async isEmptyRepo(dir: string): Promise<boolean> {
    try {
      await this.git(dir, ['rev-parse', '--verify', 'HEAD']);
      return false; // HEAD resolves → at least one commit
    } catch {
      return true; // unborn branch → no commits yet
    }
  }

  async init(dir: string): Promise<void> {
    if (await this.isRepo(dir)) return;
    await this.git(dir, ['init']);
  }

  async status(dir: string): Promise<GitStatus> {
    const out = await this.git(dir, ['status', '--porcelain=v1', '--branch']);
    return parseStatus(out);
  }

  async currentBranch(dir: string): Promise<string | null> {
    const out = (await this.git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    return out === '' || out === 'HEAD' ? null : out;
  }

  async listBranches(dir: string): Promise<string[]> {
    const out = await this.git(dir, ['branch', '--format=%(refname:short)']);
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '');
  }

  async createBranch(dir: string, name: string): Promise<void> {
    assertSafeRef(name);
    await this.git(dir, ['checkout', '-b', name]);
  }

  async checkout(dir: string, branch: string): Promise<void> {
    assertSafeRef(branch);
    await this.git(dir, ['checkout', branch]);
  }

  async commitAll(dir: string, message: string): Promise<void> {
    await this.git(dir, ['add', '-A']);
    await this.git(dir, ['commit', '-m', message]);
  }

  async fetch(dir: string): Promise<void> {
    await this.git(dir, ['fetch', '--prune']);
  }

  async pull(dir: string): Promise<void> {
    await this.git(dir, ['pull', '--ff-only']);
  }

  async push(dir: string): Promise<void> {
    if (await this.branchHasUpstream(dir)) {
      await this.git(dir, ['push']);
      return;
    }
    // No upstream yet: set it to origin on first push, or fail clearly if there is no remote.
    if (!(await this.originUrl(dir))) {
      throw new AppError('GIT_NO_REMOTE', 'execution', 'No remote is configured for this workspace.');
    }
    const branch = await this.currentBranch(dir);
    if (!branch) {
      throw new AppError('GIT_DETACHED', 'execution', 'Cannot push a detached HEAD.');
    }
    await this.git(dir, ['push', '-u', 'origin', branch]);
  }

  async discardAll(dir: string): Promise<void> {
    // Tracked files back to HEAD (index + worktree), then drop untracked files/dirs. `git clean`
    // honors .gitignore, so the local `.swaft/` cache is preserved.
    await this.git(dir, ['restore', '--staged', '--worktree', '.']);
    await this.git(dir, ['clean', '-fd']);
  }

  async clone(url: string, parentDir: string): Promise<string> {
    assertSafeArg(url, 'GIT_INVALID_URL', 'repository URL');
    const name = deriveRepoName(url);
    await this.git(parentDir, ['clone', url, name]);
    return join(parentDir, name);
  }

  async originUrl(dir: string): Promise<string | null> {
    try {
      return (await this.git(dir, ['remote', 'get-url', 'origin'])).trim() || null;
    } catch {
      return null;
    }
  }

  async addRemote(dir: string, name: string, url: string): Promise<void> {
    assertSafeArg(name, 'GIT_INVALID_REF', 'remote name');
    assertSafeArg(url, 'GIT_INVALID_URL', 'repository URL');
    await this.git(dir, ['remote', 'add', name, url]);
  }

  async showHead(dir: string, path: string): Promise<string | null> {
    try {
      // The path is embedded in the object spec (`HEAD:<path>`), so it can't be read as an option.
      return await this.git(dir, ['show', `HEAD:${path}`]);
    } catch {
      return null; // untracked/new file, or no commit yet
    }
  }

  /** Whether the current branch has a configured upstream (so a plain `git push` will work). */
  private async branchHasUpstream(dir: string): Promise<boolean> {
    try {
      await this.git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
      return true;
    } catch {
      return false;
    }
  }
}

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/** Parse `git status --porcelain=v1 --branch` output into a {@link GitStatus}. */
export function parseStatus(out: string): GitStatus {
  const lines = out.split('\n').filter((l) => l !== '');
  let branch: string | null = null;
  let detached = false;
  let hasUpstream = false;
  let ahead = 0;
  let behind = 0;
  const files: GitFileChange[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const info = line.slice(3);
      if (info.startsWith('HEAD (no branch)')) {
        detached = true;
        continue;
      }
      // Forms: "main", "main...origin/main", "main...origin/main [ahead 1, behind 2]",
      // "No commits yet on main".
      const noCommits = info.match(/^No commits yet on (.+)$/);
      if (noCommits) {
        branch = noCommits[1]!.trim();
        continue;
      }
      const upstreamSplit = info.split('...');
      branch = upstreamSplit[0]!.trim();
      if (upstreamSplit.length > 1) {
        hasUpstream = true;
        ahead = Number(info.match(/ahead (\d+)/)?.[1] ?? 0);
        behind = Number(info.match(/behind (\d+)/)?.[1] ?? 0);
      }
      continue;
    }

    const xy = line.slice(0, 2);
    // Renames/copies are emitted as "old -> new"; keep the current (new) path.
    const raw = line.slice(3);
    const arrow = raw.indexOf(' -> ');
    const path = arrow === -1 ? raw : raw.slice(arrow + 4);
    if (xy === '??') {
      files.push({ path, status: 'untracked', staged: false });
      continue;
    }
    if (CONFLICT_CODES.has(xy)) {
      files.push({ path, status: 'conflicted', staged: false });
      continue;
    }
    const index = xy[0]!;
    const worktree = xy[1]!;
    const staged = index !== ' ' && index !== '?';
    // Prefer the worktree change kind when present, else the staged one.
    const code = worktree !== ' ' ? worktree : index;
    files.push({ path, status: statusFromCode(code), staged });
  }

  return { branch, detached, hasUpstream, ahead, behind, clean: files.length === 0, files };
}

function statusFromCode(code: string): GitFileChange['status'] {
  switch (code) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    default:
      return 'modified';
  }
}
