import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type {
  GitAvailabilityResponse,
  GitFileChange,
  GitFileDiffResponse,
  GitStatusDto,
  WorkspaceSummary,
} from '@swaft/shared';
import { AppError } from '../errors';
import { scanWorkspaceForSecrets } from '../workspace/projection/projection';
import type { WorkspaceService } from '../workspace/WorkspaceService';
import type { GitService } from './GitService';

/** The 🟢 collection tables whose files carry a human-named entity. */
type EntityTable = 'projects' | 'folders' | 'tags' | 'environments' | 'templates';
type NameMaps = Record<EntityTable, Map<string, string>>;

/** Which entity (table + id) a versioned file belongs to, or undefined for chrome/unknown files. */
export function entityRefForPath(path: string): { table: EntityTable; id: string } | undefined {
  let m: RegExpExecArray | null;
  if ((m = /^projects\/(.+)\.json$/.exec(path))) return { table: 'projects', id: m[1]! };
  if ((m = /^folders\/(.+)\.json$/.exec(path))) return { table: 'folders', id: m[1]! };
  if ((m = /^tags\/(.+)\.json$/.exec(path))) return { table: 'tags', id: m[1]! };
  if ((m = /^environments\/(.+)\.json$/.exec(path))) return { table: 'environments', id: m[1]! };
  if ((m = /^templates\/([^/]+)\//.exec(path))) return { table: 'templates', id: m[1]! };
  return undefined;
}

/** Resolve the display name of the entity a versioned file belongs to (or undefined). */
export function entityNameForPath(path: string, names: NameMaps): string | undefined {
  const ref = entityRefForPath(path);
  return ref ? names[ref.table].get(ref.id) : undefined;
}

/**
 * Orchestrates the `git.*` ops against the open Git workspace: it bridges the {@link GitService}
 * (raw git commands on the repo directory) and the {@link WorkspaceService} lifecycle, applying the
 * two rules that keep the in-memory store and the on-disk files coherent:
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

  /** Whether git is usable in the main process (gates the Git storage mode in the UI). */
  async available(): Promise<GitAvailabilityResponse> {
    const [available, version] = await Promise.all([this.git.isAvailable(), this.git.version()]);
    return { available, version };
  }

  /** Re-materialize the in-memory store from disk (after an external edit / CLI pull). */
  async reload(): Promise<GitStatusDto> {
    await this.ws.reload();
    return this.status();
  }

  /** The committed (HEAD) vs working-tree contents of a changed file, for the diff view. */
  async fileDiff(path: string): Promise<GitFileDiffResponse> {
    const dir = this.dir();
    const old = await this.git.showHead(dir, path);
    const full = join(dir, path);
    const current = existsSync(full) ? readFileSync(full, 'utf8') : null;
    return { path, old, current };
  }

  async status(): Promise<GitStatusDto> {
    const dir = this.dir();
    const [status, branches, remoteUrl] = await Promise.all([
      this.git.status(dir),
      this.git.listBranches(dir),
      this.git.originUrl(dir),
    ]);
    return { ...status, files: await this.withLabels(status.files), branches, remoteUrl };
  }

  /** Enrich changed files with the display name of the entity they belong to. */
  private async withLabels(files: GitFileChange[]): Promise<GitFileChange[]> {
    const refs = files.map((f) => entityRefForPath(f.path));
    const tables = new Set(refs.flatMap((r) => (r ? [r.table] : [])));
    if (tables.size === 0) return files;

    // Query only the tables actually referenced by the changed files.
    const adapter = this.ws.requireAdapter();
    const names: NameMaps = {
      projects: new Map(),
      folders: new Map(),
      tags: new Map(),
      environments: new Map(),
      templates: new Map(),
    };
    await Promise.all(
      [...tables].map(async (table) => {
        const rows = await adapter.all<{ id: string; name: string }>(
          `SELECT id, name FROM ${table}`,
        );
        names[table] = new Map(rows.map((r) => [r.id, r.name]));
      }),
    );

    return files.map((f, i) => {
      const ref = refs[i];
      const label = ref ? names[ref.table].get(ref.id) : undefined;
      return label ? { ...f, label } : f;
    });
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

  /**
   * Commit every change. Refuses (unless `force`) when the workspace's own files would contain a
   * probable secret literal (open-standards §3.4) — `AppError('SECRETS_FOUND', ...)` carries the
   * findings (redacted hints only, never a full value) for the renderer's confirm-and-retry dialog.
   * Local (non-git) folder saves are not gated the same way — a git commit is the one point that
   * durably captures a literal secret into shared history, so that's where the stakes justify a gate.
   */
  async commit(message: string, force = false): Promise<GitStatusDto> {
    if (!force) {
      const findings = await scanWorkspaceForSecrets(this.ws.requireAdapter());
      if (findings.length > 0) {
        throw new AppError(
          'SECRETS_FOUND',
          'validation',
          'Some files look like they contain a literal secret value instead of a secret(...) reference.',
          { findings },
        );
      }
    }
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
