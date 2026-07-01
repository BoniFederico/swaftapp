import { randomUUID } from 'node:crypto';
import type { DbHistoryItem } from '@swaft/shared';
import { RepoBase } from './RepoBase';

interface DbHistoryRow {
  id: string;
  engine: string;
  sql: string;
  status: string;
  created_at: string;
}

/** 🔵 local-only, metadata-only query history (engine/sql/status — never result rows). */
export class DbHistoryService extends RepoBase {
  async record(engine: string, sql: string, status: string): Promise<void> {
    await this.adapter.run(
      `INSERT INTO db_history (id, engine, sql, status, created_at) VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), engine, sql, status, this.ws.nowIso()],
    );
    await this.ws.save();
  }

  async list(): Promise<DbHistoryItem[]> {
    const rows = await this.adapter.all<DbHistoryRow>(
      `SELECT id, engine, sql, status, created_at FROM db_history ORDER BY created_at DESC LIMIT 100`,
    );
    return rows.map((r) => ({
      id: r.id,
      engine: r.engine,
      sql: r.sql,
      status: r.status,
      createdAt: r.created_at,
    }));
  }

  async clear(): Promise<DbHistoryItem[]> {
    await this.adapter.run(`DELETE FROM db_history`);
    await this.ws.save();
    return [];
  }
}
