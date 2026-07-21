import type { ExecutionMode, StorageMode } from '@swaft/shared';
import { AppError } from '../errors';
import type { DbBackend } from '../storage/db-backend';
import type { Row, SqlParam } from '../storage/sqlite';
import { MIGRATIONS, SCHEMA_DDL, SCHEMA_VERSION } from '../storage/schema';

/**
 * Local `.swaft` repository adapter over a {@link DbBackend}. Services depend on this (not on sql.js
 * or a transport), so the storage engine and execution strategy stay swappable. Exposes the workspace
 * metadata/lifecycle plus generic query helpers used by the M5 organization/settings repositories.
 */
export interface WorkspaceMetaRow {
  id: string;
  name: string;
  icon: string | null;
  storage_mode: string;
  execution_mode: string;
  device_id: string;
  created_at: string;
  updated_at: string;
  updated_by_device_id: string;
  revision: number;
  deleted_at: string | null;
}

const META_ID = 'workspace';

export class LocalAdapter {
  constructor(private readonly db: DbBackend) {}

  // --- Generic query surface (used by repositories) -------------------------
  run(sql: string, params: SqlParam[] = []): Promise<void> {
    return this.db.run(sql, params);
  }
  all<T = Row>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return this.db.all<T>(sql, params);
  }
  get<T = Row>(sql: string, params: SqlParam[] = []): Promise<T | null> {
    return this.db.get<T>(sql, params);
  }

  // --- Lifecycle ------------------------------------------------------------

  /** Create the current schema and stamp its version on an empty database (no rows written). */
  async createSchema(): Promise<void> {
    await this.db.exec(SCHEMA_DDL);
    await this.db.setUserVersion(SCHEMA_VERSION);
  }

  /** Create the schema, stamp the version, and write the singleton workspace-metadata row. */
  async initialize(input: {
    name: string;
    storageMode: StorageMode;
    executionMode: ExecutionMode;
    deviceId: string;
    now: string;
  }): Promise<void> {
    await this.createSchema();
    await this.db.run(
      `INSERT INTO workspace_meta
        (id, name, storage_mode, execution_mode, device_id,
         created_at, updated_at, updated_by_device_id, revision, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        META_ID,
        input.name,
        input.storageMode,
        input.executionMode,
        input.deviceId,
        input.now,
        input.now,
        input.deviceId,
        1,
      ],
    );
  }

  /**
   * Bring an opened file to the current schema: reject a newer file (SCHEMA_TOO_NEW), else apply any
   * forward-only migrations whose target is above the file's version, then stamp the new version.
   */
  async migrateToCurrent(): Promise<void> {
    const version = await this.db.userVersion();
    if (version > SCHEMA_VERSION) {
      throw new AppError(
        'SCHEMA_TOO_NEW',
        'validation',
        `This workspace was created by a newer version of Swaft (schema v${version} > v${SCHEMA_VERSION}). Please update Swaft.`,
        { fileVersion: version, supportedVersion: SCHEMA_VERSION },
      );
    }
    if (version === SCHEMA_VERSION) return;
    for (const migration of MIGRATIONS) {
      if (migration.to > version) await this.db.exec(migration.sql);
    }
    await this.db.setUserVersion(SCHEMA_VERSION);
  }

  getMeta(): Promise<WorkspaceMetaRow | null> {
    return this.db.get<WorkspaceMetaRow>('SELECT * FROM workspace_meta WHERE id = ?', [META_ID]);
  }

  /** Update workspace name/icon, bumping sync metadata. */
  async updateMeta(
    set: { name?: string; icon?: string | null },
    deviceId: string,
    now: string,
  ): Promise<void> {
    const cols = Object.keys(set) as (keyof typeof set)[];
    if (cols.length === 0) return;
    const assignments = cols.map((c) => `${c} = ?`).join(', ');
    await this.db.run(
      `UPDATE workspace_meta SET ${assignments}, updated_at = ?, updated_by_device_id = ?, revision = revision + 1
       WHERE id = ?`,
      [...cols.map((c) => set[c] ?? null), now, deviceId, META_ID],
    );
  }

  serialize(): Promise<Uint8Array> {
    return this.db.serialize();
  }

  close(): Promise<void> {
    return this.db.close();
  }
}
