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
import type { LocalAdapter } from './LocalAdapter';
import { LocalFilePersistence, type WorkspaceFs } from './persistence/LocalFilePersistence';
import type { WorkspacePersistence } from './persistence/WorkspacePersistence';

export type { WorkspaceFs };

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
  /** Optional `git` persistence; when provided, the `git` storage mode becomes available. */
  git?: WorkspacePersistence;
  /**
   * Probe a target's kind so `open` can pick local (a `.swaft` file) vs git (a repo directory).
   * Defaults to treating every target as a file (git mode disabled) when omitted.
   */
  probePath?: (path: string) => Promise<'file' | 'dir' | 'missing'>;
}

interface OpenState {
  summary: WorkspaceSummary;
  adapter: LocalAdapter;
  persistence: WorkspacePersistence;
  /** Held in memory only while open, to re-encrypt on save. Never persisted/sent to the renderer. */
  password?: string;
}

/**
 * Owns the lifecycle of the single open workspace: create / open / close / save. The byte ⇄ disk
 * work is delegated to a {@link WorkspacePersistence} strategy selected by the (immutable) storage
 * mode; today only {@link LocalFilePersistence} (`local`) exists, with a `git` strategy planned
 * (see `git.md`). This class keeps the serializing lock, the surfaced summary, the forward-only
 * schema gate and revision bookkeeping. See SWAFT_STORAGE_SYNC_MODEL.md §2–§3, §13.
 */
export class WorkspaceService {
  private state: OpenState | null = null;
  private rev = 0;
  private queue: Promise<unknown> = Promise.resolve();
  /** The default (`local`) persistence, built from the injected backend/crypto/fs. */
  private readonly local: LocalFilePersistence;

  constructor(private readonly deps: WorkspaceServiceDeps) {
    this.local = new LocalFilePersistence({
      createBackend: deps.createBackend,
      crypto: deps.crypto,
      fs: deps.fs,
    });
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  /** The `git` persistence, or a clear error when git mode is not available in this build/host. */
  private requireGit(): WorkspacePersistence {
    if (!this.deps.git) {
      throw new AppError('GIT_MODE_UNAVAILABLE', 'policy', 'Git workspaces are not available.');
    }
    return this.deps.git;
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

    // Presence of a secret is what turns encryption on downstream.
    const mode: StorageMode = req.storageMode ?? 'local';
    if (mode === 'git' && req.encrypt) {
      throw new AppError(
        'ENCRYPTION_NOT_SUPPORTED',
        'validation',
        'Git workspaces are stored as plain files and cannot be encrypted.',
      );
    }
    const secret = mode === 'local' && req.encrypt ? password : undefined;
    const executionMode: ExecutionMode = req.executionMode ?? 'sandbox';
    // Storage mode is immutable and drives the persistence strategy.
    const persistence = mode === 'git' ? this.requireGit() : this.local;
    const deviceId = this.deps.deviceId();

    await this.closeCurrent();
    const opened = await persistence.create({
      name: req.name,
      executionMode,
      deviceId,
      now: this.now(),
      location: req.location,
      secret,
    });

    const summary: WorkspaceSummary = {
      name: req.name,
      icon: null,
      path: req.location,
      storageMode: persistence.kind,
      executionMode,
      encrypted: opened.encrypted,
    };
    this.state = { summary, adapter: opened.adapter, persistence, password: secret };
    this.rev++;
    this.deps.onOpened?.(summary);
    return summary;
  }

  open(req: WorkspaceOpenRequest): Promise<WorkspaceSummary> {
    return this.locked(() => this.doOpen(req));
  }

  private async doOpen(req: WorkspaceOpenRequest): Promise<WorkspaceSummary> {
    // A `.swaft` file opens as `local`; a directory opens as a `git` repo. Without a probe (tests)
    // every target is treated as a local file.
    const kind = (await this.deps.probePath?.(req.path)) ?? 'file';
    if (kind === 'missing') {
      throw new AppError('WORKSPACE_NOT_FOUND', 'not_found', 'Workspace not found.');
    }
    const persistence = kind === 'dir' ? this.requireGit() : this.local;

    // Open is atomic: materialize the new workspace first (this throws WORKSPACE_NOT_FOUND /
    // PASSWORD_REQUIRED / WRONG_WORKSPACE_PASSWORD / SCHEMA_TOO_NEW / INVALID_WORKSPACE without
    // touching the currently-open one), and only then swap it in.
    const opened = await persistence.open({ location: req.path, password: req.password });
    try {
      const meta = await opened.adapter.getMeta();
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
        encrypted: opened.encrypted,
      };
      await this.closeCurrent();
      this.state = {
        summary,
        adapter: opened.adapter,
        persistence,
        password: opened.encrypted ? req.password : undefined,
      };
      this.rev++;
      this.deps.onOpened?.(summary);
      return summary;
    } catch (err) {
      await opened.adapter.close().catch(() => undefined);
      throw err;
    }
  }

  /** Re-serialize (and re-encrypt) the open workspace to disk. Used by editing flows (M5+). */
  save(): Promise<void> {
    return this.locked(async () => {
      if (!this.state) return;
      this.rev++;
      await this.state.persistence.save(
        this.state.adapter,
        this.state.summary.path,
        this.state.password,
      );
    });
  }

  close(): Promise<void> {
    return this.locked(async () => {
      this.rev++;
      await this.closeCurrent();
    });
  }

  /**
   * Rebuild the in-memory store from disk for the open workspace. Used after an external change to
   * the on-disk form — chiefly a `git pull` / branch checkout, which rewrites the workspace files
   * under the app. Re-materialization is atomic (a failure leaves the current store intact), and the
   * summary is refreshed since name/icon/execution mode may have changed on the incoming revision.
   */
  reload(): Promise<WorkspaceSummary> {
    return this.locked(() => this.doReload());
  }

  private async doReload(): Promise<WorkspaceSummary> {
    if (!this.state) throw new AppError('WORKSPACE_REQUIRED', 'policy', 'No workspace is open.');
    const { persistence, summary, password } = this.state;
    const opened = await persistence.open({ location: summary.path, password });
    try {
      const meta = await opened.adapter.getMeta();
      if (!meta) {
        throw new AppError(
          'INVALID_WORKSPACE',
          'validation',
          'The workspace is missing its metadata.',
        );
      }
      const next: WorkspaceSummary = {
        name: meta.name,
        icon: meta.icon,
        path: summary.path,
        storageMode: meta.storage_mode as StorageMode,
        executionMode: meta.execution_mode as ExecutionMode,
        encrypted: opened.encrypted,
      };
      await this.state.adapter.close().catch(() => undefined);
      this.state = { summary: next, adapter: opened.adapter, persistence, password };
      this.rev++;
      return next;
    } catch (err) {
      await opened.adapter.close().catch(() => undefined);
      throw err;
    }
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
