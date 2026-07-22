import { AppError } from '../../errors';
import type { CryptoService } from '../../crypto/CryptoService';
import type { DbBackend } from '../../storage/db-backend';
import { LocalAdapter } from '../LocalAdapter';
import type {
  CreateParams,
  OpenParams,
  OpenedWorkspace,
  WorkspacePersistence,
} from './WorkspacePersistence';

/** Filesystem port (injected) so persistence is testable without touching the real disk. */
export interface WorkspaceFs {
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, bytes: Uint8Array): Promise<void>;
}

export interface LocalFilePersistenceDeps {
  /** Build a DB backend, optionally from existing bytes (worker in prod, in-process in tests). */
  createBackend: (bytes?: Uint8Array) => Promise<DbBackend>;
  crypto: CryptoService;
  fs: WorkspaceFs;
}

/**
 * The default `local` storage mode: a workspace is a **single `.swaft` file** holding a serialized
 * SQLite image, optionally wrapped in whole-file AES-256-GCM encryption. This class owns the byte ⇄
 * file round trip; {@link import('../WorkspaceService').WorkspaceService}
 * owns lifecycle state and the surfaced summary.
 */
export class LocalFilePersistence implements WorkspacePersistence {
  readonly kind = 'local' as const;

  constructor(private readonly deps: LocalFilePersistenceDeps) {}

  async create(params: CreateParams): Promise<OpenedWorkspace> {
    const adapter = new LocalAdapter(await this.deps.createBackend());
    await adapter.initialize({
      name: params.name,
      storageMode: this.kind,
      executionMode: params.executionMode,
      deviceId: params.deviceId,
      now: params.now,
    });
    await this.flush(adapter, params.location, params.secret);
    return { adapter, encrypted: Boolean(params.secret) };
  }

  async open(params: OpenParams): Promise<OpenedWorkspace> {
    const file = await this.deps.fs.read(params.location);
    if (!file) {
      throw new AppError('WORKSPACE_NOT_FOUND', 'not_found', 'Workspace file not found.');
    }

    const encrypted = this.deps.crypto.isEncrypted(file);
    let image: Uint8Array;
    if (encrypted) {
      if (!params.password) {
        throw new AppError(
          'PASSWORD_REQUIRED',
          'validation',
          'This workspace is encrypted; a password is required to open it.',
        );
      }
      image = await this.deps.crypto.decrypt(file, params.password); // → WRONG_WORKSPACE_PASSWORD
    } else {
      image = file;
    }

    let adapter: LocalAdapter | undefined;
    try {
      adapter = new LocalAdapter(await this.deps.createBackend(image));
      await adapter.migrateToCurrent(); // → SCHEMA_TOO_NEW (an AppError, re-thrown below)
      return { adapter, encrypted };
    } catch (err) {
      await adapter?.close().catch(() => undefined);
      if (err instanceof AppError) throw err;
      // Any other failure (e.g. sql.js "file is not a database") → invalid workspace.
      throw new AppError('INVALID_WORKSPACE', 'validation', 'The file is not a valid Swaft workspace.');
    }
  }

  save(adapter: LocalAdapter, location: string, secret?: string): Promise<void> {
    return this.flush(adapter, location, secret);
  }

  /** Serialize the adapter, optionally encrypt with `secret`, and atomically write it to `location`. */
  private async flush(adapter: LocalAdapter, location: string, secret?: string): Promise<void> {
    const image = await adapter.serialize();
    const out = secret ? await this.deps.crypto.encrypt(image, secret) : image;
    await this.deps.fs.write(location, out);
  }
}
