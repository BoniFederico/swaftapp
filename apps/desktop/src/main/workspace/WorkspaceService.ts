import type {
  ExecutionMode,
  StorageMode,
  WorkspaceCreateRequest,
  WorkspaceOpenRequest,
  WorkspaceSummary,
} from '@swaft/shared';
import { AppError } from '../errors';
import type { CryptoService } from '../crypto/CryptoService';
import type { DbBackend } from '../storage/db-backend';
import { LocalAdapter } from './LocalAdapter';

/** Filesystem port (injected) so the service is testable without touching the real disk. */
export interface WorkspaceFs {
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, bytes: Uint8Array): Promise<void>;
}

export interface WorkspaceServiceDeps {
  /** Build a DB backend, optionally from existing bytes (worker in prod, in-process in tests). */
  createBackend: (bytes?: Uint8Array) => Promise<DbBackend>;
  crypto: CryptoService;
  fs: WorkspaceFs;
  /** Stable per-install device id, stamped into sync metadata. */
  deviceId: () => string;
  /** Called after a workspace is opened/created (used to update the recent list). */
  onOpened?: (summary: WorkspaceSummary) => void;
  now?: () => Date;
}

interface OpenState {
  summary: WorkspaceSummary;
  adapter: LocalAdapter;
  /** Held in memory only while open, to re-encrypt on save. Never persisted/sent to the renderer. */
  password?: string;
}

/**
 * Owns the lifecycle of the single open workspace: create / open / close / save. Enforces the
 * **immutable** storage mode (only `local` in the MVP), optional whole-file encryption, and the
 * forward-only schema gate. All DB work goes through the injected (worker-backed) {@link DbBackend}.
 * See SWAFT_STORAGE_SYNC_MODEL.md §2–§3, §13.
 */
export class WorkspaceService {
  private state: OpenState | null = null;
  private rev = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: WorkspaceServiceDeps) {}

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  /**
   * Lifecycle transitions and saves run one at a time. IPC handlers are not serialized by Electron,
   * so without this two concurrent saves could write serialized images out of order (older image
   * wins), or a close could tear the adapter out from under an in-flight save.
   */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn);
    this.queue = result.catch(() => undefined);
    return result;
  }

  create(req: WorkspaceCreateRequest): Promise<WorkspaceSummary> {
    return this.locked(() => this.doCreate(req));
  }

  private async doCreate(req: WorkspaceCreateRequest): Promise<WorkspaceSummary> {
    const password = req.password;
    if (req.encrypt && (!password || password.length < 8)) {
      throw new AppError(
        'PASSWORD_REQUIRED',
        'validation',
        'A password of at least 8 characters is required to encrypt the workspace.',
      );
    }

    const storageMode: StorageMode = 'local'; // immutable in the MVP (p2p/server reserved)
    const executionMode: ExecutionMode = req.executionMode ?? 'sandbox';
    const deviceId = this.deps.deviceId();

    await this.closeCurrent();
    const backend = await this.deps.createBackend();
    const adapter = new LocalAdapter(backend);
    await adapter.initialize({ name: req.name, storageMode, executionMode, deviceId, now: this.now() });

    const image = await adapter.serialize();
    const fileBytes =
      req.encrypt && password ? await this.deps.crypto.encrypt(image, password) : image;
    await this.deps.fs.write(req.location, fileBytes);

    const summary: WorkspaceSummary = {
      name: req.name,
      icon: null,
      path: req.location,
      storageMode,
      executionMode,
      encrypted: Boolean(req.encrypt),
    };
    this.state = { summary, adapter, password: req.encrypt ? password : undefined };
    this.rev++;
    this.deps.onOpened?.(summary);
    return summary;
  }

  open(req: WorkspaceOpenRequest): Promise<WorkspaceSummary> {
    return this.locked(() => this.doOpen(req));
  }

  private async doOpen(req: WorkspaceOpenRequest): Promise<WorkspaceSummary> {
    const file = await this.deps.fs.read(req.path);
    if (!file) {
      throw new AppError('WORKSPACE_NOT_FOUND', 'not_found', 'Workspace file not found.');
    }

    const encrypted = this.deps.crypto.isEncrypted(file);
    let image: Uint8Array;
    if (encrypted) {
      if (!req.password) {
        throw new AppError(
          'PASSWORD_REQUIRED',
          'validation',
          'This workspace is encrypted; a password is required to open it.',
        );
      }
      image = await this.deps.crypto.decrypt(file, req.password); // → WRONG_WORKSPACE_PASSWORD
    } else {
      image = file;
    }

    await this.closeCurrent();
    let adapter: LocalAdapter | undefined;
    try {
      adapter = new LocalAdapter(await this.deps.createBackend(image));
      await adapter.migrateToCurrent(); // → SCHEMA_TOO_NEW (an AppError, re-thrown below)
      const meta = await adapter.getMeta();
      if (!meta) {
        throw new AppError(
          'INVALID_WORKSPACE',
          'validation',
          'The workspace file is missing its metadata.',
        );
      }

      const summary: WorkspaceSummary = {
        name: meta.name,
        icon: meta.icon,
        path: req.path,
        storageMode: meta.storage_mode as StorageMode,
        executionMode: meta.execution_mode as ExecutionMode,
        encrypted,
      };
      this.state = { summary, adapter, password: encrypted ? req.password : undefined };
      this.rev++;
      this.deps.onOpened?.(summary);
      return summary;
    } catch (err) {
      await adapter?.close().catch(() => undefined);
      if (err instanceof AppError) throw err;
      // Any other failure (e.g. sql.js "file is not a database") → invalid workspace.
      throw new AppError('INVALID_WORKSPACE', 'validation', 'The file is not a valid Swaft workspace.');
    }
  }

  /** Re-serialize (and re-encrypt) the open workspace to disk. Used by editing flows (M5+). */
  save(): Promise<void> {
    return this.locked(async () => {
      if (!this.state) return;
      this.rev++;
      const image = await this.state.adapter.serialize();
      const out = this.state.password
        ? await this.deps.crypto.encrypt(image, this.state.password)
        : image;
      await this.deps.fs.write(this.state.summary.path, out);
    });
  }

  close(): Promise<void> {
    return this.locked(async () => {
      this.rev++;
      await this.closeCurrent();
    });
  }

  /**
   * Monotonic counter bumped whenever the workspace content may have changed (every `save`, plus
   * create/open/close). Read-through caches over workspace data — e.g. the user-capability registry, which
   * would otherwise re-read and re-hash every capability template on each render — use it as a cheap
   * invalidation signal instead of subscribing to per-table events.
   */
  get revision(): number {
    return this.rev;
  }

  current(): WorkspaceSummary | null {
    return this.state?.summary ?? null;
  }

  /** Update the open workspace's name/icon (workspace_meta), persist, and return the new summary. */
  async update(patch: { name?: string; icon?: string | null }): Promise<WorkspaceSummary> {
    if (!this.state) throw new AppError('WORKSPACE_REQUIRED', 'policy', 'No workspace is open.');
    const set: { name?: string; icon?: string | null } = {};
    if (patch.name !== undefined) set.name = patch.name.trim();
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (Object.keys(set).length > 0) {
      await this.state.adapter.updateMeta(set, this.deviceId(), this.now());
      await this.save();
      this.state.summary = {
        ...this.state.summary,
        ...(set.name !== undefined ? { name: set.name } : {}),
        ...(set.icon !== undefined ? { icon: set.icon } : {}),
      };
    }
    return this.state.summary;
  }

  /** The open workspace's adapter; throws WORKSPACE_REQUIRED when no workspace is open. */
  requireAdapter(): LocalAdapter {
    if (!this.state) {
      throw new AppError('WORKSPACE_REQUIRED', 'policy', 'No workspace is open.');
    }
    return this.state.adapter;
  }

  /** Stable per-install device id, stamped into sync metadata. */
  deviceId(): string {
    return this.deps.deviceId();
  }

  nowIso(): string {
    return this.now();
  }

  private async closeCurrent(): Promise<void> {
    if (this.state) {
      // Best-effort: closing a dead backend (e.g. a crashed DB worker) must not wedge the
      // lifecycle — the point of closing is to let the user open/create the next workspace.
      await this.state.adapter.close().catch(() => undefined);
      this.state = null;
    }
  }
}
