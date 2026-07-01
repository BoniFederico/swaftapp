import type { SqlParam } from '../storage/sqlite';
import type { WorkspaceService } from './WorkspaceService';

/**
 * Shared CRUD helpers for 🟢 synchronized entities living in the open `.swaft`. Stamps sync metadata
 * on insert/update and uses soft-delete tombstones so a future sync engine can reconcile changes
 * (SWAFT_STORAGE_SYNC_MODEL.md §3). Table names are internal literals, never user input.
 */
export abstract class RepoBase {
  constructor(protected readonly ws: WorkspaceService) {}

  protected get adapter() {
    return this.ws.requireAdapter();
  }

  /** Insert a row, adding the sync-metadata columns (revision 1, not deleted). */
  protected async insertEntity(table: string, domain: Record<string, SqlParam>): Promise<void> {
    const now = this.ws.nowIso();
    const row: Record<string, SqlParam> = {
      ...domain,
      created_at: now,
      updated_at: now,
      updated_by_device_id: this.ws.deviceId(),
      revision: 1,
      deleted_at: null,
    };
    const cols = Object.keys(row);
    const placeholders = cols.map(() => '?').join(', ');
    await this.adapter.run(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
      cols.map((c) => row[c]),
    );
  }

  /** Update domain columns on a live row, bumping revision + updated_at/device. */
  protected async updateEntity(
    table: string,
    id: string,
    set: Record<string, SqlParam>,
  ): Promise<void> {
    const cols = Object.keys(set);
    const assignments = cols.map((c) => `${c} = ?`).join(', ');
    await this.adapter.run(
      `UPDATE ${table} SET ${assignments}, updated_at = ?, updated_by_device_id = ?, revision = revision + 1
       WHERE id = ? AND deleted_at IS NULL`,
      [...cols.map((c) => set[c]), this.ws.nowIso(), this.ws.deviceId(), id],
    );
  }

  /** Soft-delete (tombstone) a live row. */
  protected async softDelete(table: string, id: string): Promise<void> {
    const now = this.ws.nowIso();
    await this.adapter.run(
      `UPDATE ${table} SET deleted_at = ?, updated_at = ?, updated_by_device_id = ?, revision = revision + 1
       WHERE id = ? AND deleted_at IS NULL`,
      [now, now, this.ws.deviceId(), id],
    );
  }
}
