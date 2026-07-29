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

  it('the v25 migration adds the scenario run-history tables to an existing (pre-v25) file', async () => {
    const db = await openSqliteDb();
    const step = MIGRATIONS.find((m) => m.to === 25);
    expect(step, 'a migration to v25 must exist').toBeDefined();
    db.exec(step!.sql);
    // Both local-only run tables are created and usable.
    db.run(
      `INSERT INTO scenario_runs (id, scenario_id, status, mode, step_count, started_at) VALUES ('r1','s1','running','single',0,'t')`,
    );
    db.run(
      `INSERT INTO scenario_run_steps (id, run_id, seq, node_id, kind, status, created_at) VALUES ('st1','r1',0,'n1','api','succeeded','t')`,
    );
    expect(db.get<Row>(`SELECT scenario_id FROM scenario_runs WHERE id='r1'`)?.scenario_id).toBe('s1');
    expect(db.get<Row>(`SELECT kind FROM scenario_run_steps WHERE id='st1'`)?.kind).toBe('api');
    db.close();
  });

  it('fresh environments table carries the v26 `secret_vars` column, defaulting to an empty array', async () => {
    const db = await openSqliteDb();
    db.exec(SCHEMA_DDL);
    const cols = db.all<Row>(`PRAGMA table_info(environments)`).map((r) => String(r.name));
    expect(cols).toContain('secret_vars');
    db.close();
  });

  it('the v26 migration adds environments `secret_vars` to an existing (pre-v26) file, defaulting to []', async () => {
    const db = await openSqliteDb();
    // An environments table as it stood before v26 (no `secret_vars` column).
    db.exec(
      `CREATE TABLE environments (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, owner_kind TEXT NOT NULL, owner_id TEXT, vars TEXT NOT NULL DEFAULT '{}');`,
    );
    const step = MIGRATIONS.find((m) => m.to === 26);
    expect(step, 'a migration to v26 must exist').toBeDefined();
    db.exec(step!.sql);

    db.run(
      `INSERT INTO environments (id, name, owner_kind, vars) VALUES ('e1', 'Legacy', 'workspace', '{}')`,
    );
    const row = db.get<Row>(`SELECT secret_vars FROM environments WHERE id = 'e1'`);
    expect(row?.secret_vars).toBe('[]');
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
