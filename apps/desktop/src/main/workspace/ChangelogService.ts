import { randomUUID } from 'node:crypto';
import type { ChangelogEntryDto } from '@swaft/shared';
import { RepoBase } from './RepoBase';
import type { WorkspaceService } from './WorkspaceService';

interface ChangelogRow {
  id: string;
  entity_type: string;
  entity_id: string;
  message: string;
  username: string | null;
  created_at: string;
}

/**
 * Changelog of 🟢 synchronized changes (template edits, releases, …). Entries are append-only and
 * attributed to the acting user (`username`). `addEntry` inserts but does not persist — the caller
 * saves once per logical operation.
 */
export class ChangelogService extends RepoBase {
  constructor(
    ws: WorkspaceService,
    private readonly currentUsername: () => string | null = () => null,
  ) {
    super(ws);
  }

  async addEntry(entityType: string, entityId: string, message: string): Promise<void> {
    await this.insertEntity('changelog', {
      id: randomUUID(),
      entity_type: entityType,
      entity_id: entityId,
      message,
      username: this.currentUsername(),
    });
  }

  async listEntries(entityId: string): Promise<ChangelogEntryDto[]> {
    const rows = await this.adapter.all<ChangelogRow>(
      `SELECT id, entity_type, entity_id, message, username, created_at FROM changelog
       WHERE entity_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
      [entityId],
    );
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      message: r.message,
      username: r.username,
      createdAt: r.created_at,
    }));
  }
}
