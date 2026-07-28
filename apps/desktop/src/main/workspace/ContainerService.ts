import { basename, dirname, join } from 'node:path';
import { AppError } from '../errors';
import type { CryptoService } from '../crypto/CryptoService';
import { NodeDirFs, type DirFs } from './projection/dir-fs';
import { packContainer, unpackContainer } from './projection/container';
import type { WorkspaceService } from './WorkspaceService';

export interface ContainerServiceDeps {
  workspace: WorkspaceService;
  crypto: CryptoService;
  /** Read a file's bytes, or null when absent. Injected so the sniff is testable off-disk. */
  read: (path: string) => Promise<Uint8Array | null>;
  /** DirFs factory for the extraction target; defaults to the real filesystem. */
  dirFs?: (dir: string) => DirFs;
}

/**
 * The `.swaft` **container** (open-standards plan D1): a portable, single-file zip of the open
 * workspace folder, used to move or archive a workspace — never the live store. Export packs the
 * open workspace (optionally AES-encrypted, reusing {@link CryptoService}); opening a container
 * unzips it to a sibling working folder and hands that folder back to
 * {@link WorkspaceService} to open as a folder-backed workspace.
 */
export class ContainerService {
  constructor(private readonly deps: ContainerServiceDeps) {}

  private fs(dir: string): DirFs {
    return (this.deps.dirFs ?? ((d) => new NodeDirFs(d)))(dir);
  }

  /** Pack the open workspace into a `.swaft` zip container, optionally encrypted with `password`. */
  async export(password?: string): Promise<Uint8Array> {
    const bytes = await packContainer(this.deps.workspace.requireAdapter());
    return password ? this.deps.crypto.encrypt(bytes, password) : bytes;
  }

  /**
   * If `path` points at a `.swaft` **zip container**, unzip it to a sibling `<name>/` folder and
   * return that folder's path (to open as a folder workspace). Returns `null` when `path` is not a
   * container (e.g. a legacy single-file SQLite `.swaft`), so the caller falls back to a normal open.
   *
   * An encrypted container requires `password` (throws `PASSWORD_REQUIRED` otherwise, so the caller
   * can prompt and retry — mirroring the single-file open flow). Extraction is idempotent: an already
   * unpacked sibling folder is reused rather than overwritten.
   */
  async openAsContainer(path: string, password?: string): Promise<string | null> {
    const file = await this.deps.read(path);
    if (!file) return null;

    const encrypted = this.deps.crypto.isEncrypted(file);
    if (encrypted && !password) {
      throw new AppError(
        'PASSWORD_REQUIRED',
        'validation',
        'This container is encrypted; a password is required to open it.',
      );
    }
    const plain = encrypted ? await this.deps.crypto.decrypt(file, password!) : file;

    const dest = join(dirname(path), basename(path).replace(/\.swaft$/i, '') || 'workspace');
    const destFs = this.fs(dest);
    // Already unpacked here before → reuse it (idempotent re-open, no clobber).
    if ((await destFs.readFile('workspace.json')) != null) return dest;

    // unpackContainer verifies the zip magic; a non-container (legacy SQLite image) throws
    // INVALID_WORKSPACE, which we translate to "not a container" so the normal open path runs.
    try {
      await unpackContainer(plain, destFs);
    } catch (err) {
      if (err instanceof AppError && err.code === 'INVALID_WORKSPACE') return null;
      throw err;
    }
    return dest;
  }
}
