import type { ExecutionMode, StorageMode } from '@swaft/shared';
import type { LocalAdapter } from '../LocalAdapter';

/**
 * Persistence strategy for a workspace: it maps a workspace between its in-memory SQLite working
 * store (a {@link LocalAdapter}) and its on-disk form, and nothing else. Lifecycle orchestration —
 * the single-open-workspace state, the serializing lock, revision bookkeeping and the surfaced
 * {@link import('@swaft/shared').WorkspaceSummary} — stays in {@link import('../WorkspaceService').WorkspaceService}.
 *
 * This is the seam the storage mode selects on: {@link LocalFilePersistence} implements the current
 * single-`.swaft`-file behavior, and a future `GitPersistence` (see `git.md`) will implement a
 * directory-of-files repo without touching services, repositories, IPC or the UI.
 *
 * Contract for `open`: it MUST have **no side effect on any already-open workspace**. A failure
 * (missing/locked/corrupt target) throws a coded {@link import('../../errors').AppError} and leaves
 * the caller's current workspace untouched — the caller closes the old adapter only once a new one
 * has opened successfully (atomic open).
 */
export interface WorkspacePersistence {
  /** The storage mode this strategy implements; stamped into new workspaces. */
  readonly kind: StorageMode;

  /** Create a brand-new, empty workspace at `location` and materialize its adapter. */
  create(params: CreateParams): Promise<OpenedWorkspace>;

  /** Open an existing workspace from `location`, returning a migrated, ready-to-use adapter. */
  open(params: OpenParams): Promise<OpenedWorkspace>;

  /** Flush the live adapter to disk. `secret` carries the in-memory encryption password, if any. */
  save(adapter: LocalAdapter, location: string, secret?: string): Promise<void>;
}

/** A freshly materialized, ready-to-use open workspace. */
export interface OpenedWorkspace {
  adapter: LocalAdapter;
  /** Whether the on-disk form is encrypted (local-file only; always false for git). */
  encrypted: boolean;
}

export interface CreateParams {
  name: string;
  executionMode: ExecutionMode;
  deviceId: string;
  /** ISO-8601 creation timestamp, provided by the caller for testability. */
  now: string;
  /** Target path (`.swaft` file) or directory (git repo) on disk. */
  location: string;
  /**
   * Encryption password, or undefined for a plaintext workspace. Presence of a secret is what turns
   * encryption on — the caller validates it up front. Ignored by strategies that never encrypt.
   */
  secret?: string;
}

export interface OpenParams {
  location: string;
  /** Password for an encrypted workspace; undefined otherwise. */
  password?: string;
}
