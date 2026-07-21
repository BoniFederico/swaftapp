import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { GitStatusDto, WorkspaceSummary } from '@swaft/shared';
import { AppError } from '../errors';
import type { WorkspaceService } from '../workspace/WorkspaceService';
import type { GitService } from './GitService';

/**
 * Orchestrates the `git.*` ops against the open Git workspace: it bridges the {@link GitService}
 * (raw git commands on the repo directory) and the {@link WorkspaceService} lifecycle, applying the
 * two rules that keep the in-memory store and the on-disk files coherent (git.md §7):
 *  - **save before commit** — flush pending in-memory edits to files so the commit captures them;
 *  - **reload after a tree-changing op** — pull / checkout / discard rewrite the files under the app,
 *    so the SQLite working store is rebuilt from disk afterwards.
 *
 * Every op returns the fresh status so the panel refreshes in a single round trip.
 */
export class GitOpsService {
  constructor(
    private readonly ws: WorkspaceService,
    private readonly git: GitService,
  ) {}

  /** The open workspace's repo directory, or a coded error when it is not a Git workspace. */
  private dir(): string {
    const current = this.ws.current();
    if (!current || current.storageMode !== 'git') {
      throw new AppError('GIT_WORKSPACE_REQUIRED', 'policy', 'No Git workspace is open.');
    }
    return current.path;
  }

  async status(): Promise<GitStatusDto> {
    const dir = this.dir();
    const [status, branches, remoteUrl] = await Promise.all([
      this.git.status(dir),
      this.git.listBranches(dir),
      this.git.originUrl(dir),
    ]);
    return { ...status, branches, remoteUrl };
  }

  /**
   * Clone `url` into a subfolder of `parentDir` and turn it into an open workspace:
   *  - an existing Swaft workspace repo (has `workspace.json`) is **opened**;
   *  - an **empty** repo (no commits — e.g. a freshly created remote) is **initialized** as a new
   *    Swaft workspace in place, keeping the `origin` remote so it can be pushed;
   *  - a non-empty repo that is not a Swaft workspace is rejected with a clear error.
   */
  async clone(url: string, parentDir: string): Promise<WorkspaceSummary> {
    const path = await this.git.clone(url, parentDir);
    if (existsSync(join(path, 'workspace.json'))) {
      return this.ws.open({ path });
    }
    if (!(await this.git.isEmptyRepo(path))) {
      throw new AppError(
        'NOT_A_SWAFT_WORKSPACE',
        'validation',
        'The cloned repository is not empty and is not a Swaft workspace.',
      );
    }
    // Empty remote: start a fresh workspace in the clone (origin is preserved for the first push).
    return this.ws.create({
      name: basename(path),
      storageMode: 'git',
      location: path,
      encrypt: false,
    });
  }

  /** Connect a local Git workspace to a remote and push it (first publish). */
  async publish(url: string): Promise<GitStatusDto> {
    const dir = this.dir();
    if (!(await this.git.originUrl(dir))) {
      await this.git.addRemote(dir, 'origin', url);
    }
    await this.git.push(dir); // sets upstream on first push
    return this.status();
  }

  async commit(message: string): Promise<GitStatusDto> {
    // Flush in-memory edits to the working tree first, so the commit captures the current state.
    await this.ws.save();
    await this.git.commitAll(this.dir(), message);
    return this.status();
  }

  async push(): Promise<GitStatusDto> {
    await this.git.push(this.dir());
    return this.status();
  }

  async fetch(): Promise<GitStatusDto> {
    await this.git.fetch(this.dir());
    return this.status();
  }

  async pull(): Promise<GitStatusDto> {
    await this.git.pull(this.dir());
    await this.ws.reload(); // files changed on disk → rebuild the in-memory store
    return this.status();
  }

  async checkout(branch: string): Promise<GitStatusDto> {
    await this.git.checkout(this.dir(), branch);
    await this.ws.reload();
    return this.status();
  }

  async createBranch(name: string): Promise<GitStatusDto> {
    // A new branch off HEAD keeps the working tree identical, so no reload is needed.
    await this.git.createBranch(this.dir(), name);
    return this.status();
  }

  async discard(): Promise<GitStatusDto> {
    await this.git.discardAll(this.dir());
    await this.ws.reload();
    return this.status();
  }
}
