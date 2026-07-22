import { AppError } from '../../errors';
import type { DbBackend } from '../../storage/db-backend';
import type { GitService } from '../../git/GitService';
import { LocalAdapter } from '../LocalAdapter';
import { NodeDirFs, type DirFs } from '../projection/dir-fs';
import { dumpWorkspace, hydrateWorkspace } from '../projection/projection';
import type {
  CreateParams,
  OpenParams,
  OpenedWorkspace,
  WorkspacePersistence,
} from './WorkspacePersistence';

const MANIFEST_FILE = 'workspace.json';

const GITIGNORE = `# Swaft Git workspace — never commit local caches or OS cruft.
/.swaft/
.DS_Store
`;

// Normalize line endings so the same workspace diffs cleanly across Windows/macOS/Linux.
const GITATTRIBUTES = `* text=auto eol=lf
`;

export interface GitPersistenceDeps {
  /** Build a DB backend (worker in prod, in-process in tests). The git working store is in-memory. */
  createBackend: (bytes?: Uint8Array) => Promise<DbBackend>;
  git: GitService;
  deviceId: () => string;
  /** ISO-8601 clock; injectable for tests. */
  now?: () => string;
  /** DirFs factory for a repo directory; injectable so tests can use an in-memory filesystem. */
  dirFs?: (dir: string) => DirFs;
}

/**
 * The `git` storage mode: a workspace is a **directory of plain, versioned files inside a Git repo**.
 * It composes the {@link import('../projection/projection').dumpWorkspace projection}
 * (DB ⇄ files) with a {@link GitService} for repository operations, and never uses encryption.
 *
 * The in-memory SQLite store stays the runtime engine; this class only materializes it from the
 * files on open and flushes it back on save. Commits/pulls/pushes are explicit user actions handled
 * elsewhere (see the `git.*` ops) — `save` merely updates the working tree.
 */
export class GitPersistence implements WorkspacePersistence {
  readonly kind = 'git' as const;

  constructor(private readonly deps: GitPersistenceDeps) {}

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  private fs(dir: string): DirFs {
    return (this.deps.dirFs ?? ((d) => new NodeDirFs(d)))(dir);
  }

  async create(params: CreateParams): Promise<OpenedWorkspace> {
    const dir = params.location;
    await this.deps.git.init(dir);

    const fs = this.fs(dir);
    await fs.writeFile('.gitignore', GITIGNORE);
    await fs.writeFile('.gitattributes', GITATTRIBUTES);

    const adapter = new LocalAdapter(await this.deps.createBackend());
    await adapter.initialize({
      name: params.name,
      storageMode: this.kind,
      executionMode: params.executionMode,
      deviceId: params.deviceId,
      now: params.now,
    });
    await dumpWorkspace(adapter, fs);
    await this.deps.git.commitAll(dir, 'Initialize Swaft workspace');
    return { adapter, encrypted: false };
  }

  async open(params: OpenParams): Promise<OpenedWorkspace> {
    const dir = params.location;
    const fs = this.fs(dir);
    if ((await fs.readFile(MANIFEST_FILE)) == null) {
      throw new AppError(
        'WORKSPACE_NOT_FOUND',
        'not_found',
        'This folder is not a Swaft workspace (no workspace.json).',
      );
    }

    const adapter = new LocalAdapter(await this.deps.createBackend());
    await adapter.createSchema();
    try {
      await hydrateWorkspace(adapter, fs, {
        deviceId: this.deps.deviceId(),
        now: this.now(),
        storageMode: this.kind,
      });
      return { adapter, encrypted: false };
    } catch (err) {
      await adapter.close().catch(() => undefined);
      if (err instanceof AppError) throw err; // SCHEMA_TOO_NEW / INVALID_WORKSPACE
      throw new AppError('INVALID_WORKSPACE', 'validation', 'The folder is not a valid Swaft workspace.');
    }
  }

  async save(adapter: LocalAdapter, location: string): Promise<void> {
    await dumpWorkspace(adapter, this.fs(location));
  }
}
