import { describe, it, expect } from 'vitest';
import { openSqliteDb, type Row } from './sqlite';
import {
  LOCAL_ONLY_TABLES,
  SCHEMA_DDL,
  SYNCHRONIZED_TABLES,
  SYNC_META_COLUMNS,
} from './schema';

async function columnsOf(table: string): Promise<string[]> {
  const db = await openSqliteDb();
  db.exec(SCHEMA_DDL);
  const cols = db.all<Row>(`PRAGMA table_info(${table})`).map((r) => String(r.name));
  db.close();
  return cols;
}

describe('.swaft schema classification', () => {
  it('synchronized entities carry every sync-metadata column', async () => {
    for (const table of SYNCHRONIZED_TABLES) {
      const cols = await columnsOf(table);
      for (const meta of SYNC_META_COLUMNS) {
        expect(cols, `${table} should have ${meta}`).toContain(meta);
      }
    }
  });

  it('local-only tables carry NO sync-metadata columns', async () => {
    for (const table of LOCAL_ONLY_TABLES) {
      const cols = await columnsOf(table);
      expect(cols).not.toContain('revision');
      expect(cols).not.toContain('updated_by_device_id');
      expect(cols).not.toContain('deleted_at');
    }
  });

  it('stores no secrets table (🟠 secure-local lives in the OS keychain, never in .swaft)', async () => {
    const db = await openSqliteDb();
    db.exec(SCHEMA_DDL);
    const tables = db
      .all<Row>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .map((r) => String(r.name));
    db.close();
    expect(tables).not.toContain('secrets');
    expect(tables).toContain('workspace_meta');
  });
});
