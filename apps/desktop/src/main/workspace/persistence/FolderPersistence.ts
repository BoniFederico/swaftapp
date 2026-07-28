import { AppError } from '../../errors';
import type { DbBackend } from '../../storage/db-backend';
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

// A local folder is not a git repo, but keeping these makes it a clean base if the user later
// `git init`s the folder (or adopts the `git` storage mode): local-only caches and OS cruft stay out.
const GITIGNORE = `# Swaft workspace — never commit local caches or OS cruft.
/.swaft/
.DS_Store
`;
const GITATTRIBUTES = `* text=auto eol=lf
`;

export interface FolderPersistenceDeps {
  /** Build a DB backend (worker in prod, in-process in tests). The working store is in-memory. */
  createBackend: (bytes?: Uint8Array) => Promise<DbBackend>;
  deviceId: () => string;
  /** ISO-8601 clock; injectable for tests. */
  now?: () => string;
  /** DirFs factory for a workspace directory; injectable so tests use an in-memory filesystem. */
  dirFs?: (dir: string) => DirFs;
}

/**
 * The folder-backed `local` storage mode (open-standards plan D1): a local workspace is a **directory
 * of plain, readable files** — the exact same on-disk form as a {@link import('./GitPersistence').GitPersistence git}
 * workspace, minus git and minus encryption. It composes the
 * {@link import('../projection/projection').dumpWorkspace projection} (DB ⇄ files); the in-memory
 * SQLite store is a cache rebuilt from the files on open and flushed back on save.
 *
 * The single-file `.swaft` form ({@link import('./LocalFilePersistence').LocalFilePersistence}) is
 * retained for legacy files and as an export/import **container**; new local workspaces are folders.
 */
export class FolderPersistence implements WorkspacePersistence {
  readonly kind = 'local' as const;

  constructor(private readonly deps: FolderPersistenceDeps) {}

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  private fs(dir: string): DirFs {
    return (this.deps.dirFs ?? ((d) => new NodeDirFs(d)))(dir);
  }

  async create(params: CreateParams): Promise<OpenedWorkspace> {
    const fs = this.fs(params.location);
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
    return { adapter, encrypted: false };
  }

  async open(params: OpenParams): Promise<OpenedWorkspace> {
    const fs = this.fs(params.location);
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
