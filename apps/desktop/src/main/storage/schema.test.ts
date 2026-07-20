import { describe, it, expect } from 'vitest';
import { openSqliteDb, type Row } from './sqlite';
import {
  LOCAL_ONLY_TABLES,
  MIGRATIONS,
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

  it('fresh folders table carries the v24 `actions` column, defaulting to an empty array', async () => {
    const db = await openSqliteDb();
    db.exec(SCHEMA_DDL);
    const cols = db.all<Row>(`PRAGMA table_info(folders)`).map((r) => String(r.name));
    expect(cols).toContain('actions');
    db.close();
  });

  it('the v24 migration adds folder `actions` to an existing (pre-v24) file, defaulting to []', async () => {
    const db = await openSqliteDb();
    // A folders table as it stood before v24 (no `actions` column).
    db.exec(`CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL);`);
    const step = MIGRATIONS.find((m) => m.to === 24);
    expect(step, 'a migration to v24 must exist').toBeDefined();
    db.exec(step!.sql);

    // A row written before/without the new column reads back the safe default, not NULL.
    db.run(`INSERT INTO folders (id, name) VALUES ('f1', 'Legacy')`);
    const row = db.get<Row>(`SELECT actions FROM folders WHERE id = 'f1'`);
    expect(row?.actions).toBe('[]');
    db.close();
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
