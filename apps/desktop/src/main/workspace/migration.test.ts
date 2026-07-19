import { describe, it, expect } from 'vitest';
import { CryptoService } from '../crypto/CryptoService';
import { InProcessDbBackend } from '../storage/db-backend';
import { SCHEMA_VERSION } from '../storage/schema';
import { openSqliteDb } from '../storage/sqlite';
import { OrganizationService } from './OrganizationService';
import { SettingsService } from './SettingsService';
import { WorkspaceService, type WorkspaceFs } from './WorkspaceService';

// The original v1 schema (M4): folders carried project_id; no settings/restrictions tables.
const V1_DDL = `
CREATE TABLE workspace_meta (id TEXT PRIMARY KEY, name TEXT NOT NULL, storage_mode TEXT NOT NULL,
  execution_mode TEXT NOT NULL, device_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  updated_by_device_id TEXT NOT NULL, revision INTEGER NOT NULL, deleted_at TEXT);
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, updated_by_device_id TEXT NOT NULL, revision INTEGER NOT NULL, deleted_at TEXT);
CREATE TABLE folders (id TEXT PRIMARY KEY, project_id TEXT, name TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, updated_by_device_id TEXT NOT NULL, revision INTEGER NOT NULL, deleted_at TEXT);
CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, updated_by_device_id TEXT NOT NULL, revision INTEGER NOT NULL, deleted_at TEXT);
CREATE TABLE local_input_state (template_id TEXT PRIMARY KEY, values_json TEXT NOT NULL, updated_at TEXT NOT NULL);
`;

async function makeV1File(): Promise<Uint8Array> {
  const db = await openSqliteDb();
  db.exec(V1_DDL);
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO workspace_meta VALUES ('workspace','Old WS','local','sandbox','dev-old',?,?,'dev-old',1,NULL)`,
    [now, now],
  );
  db.run(`INSERT INTO projects VALUES ('p1','Legacy',NULL,?,?,'dev-old',1,NULL)`, [now, now]);
  db.setUserVersion(1);
  const bytes = db.export();
  db.close();
  return bytes;
}

describe('schema migration v1 → v2', () => {
  it('upgrades a v1 workspace on open: keeps data, adds the newer tables', async () => {
    const files = new Map<string, Uint8Array>([['mem://v1.swaft', await makeV1File()]]);
    const fs: WorkspaceFs = {
      read: (p) => Promise.resolve(files.get(p) ?? null),
      write: (p, b) => {
        files.set(p, b);
        return Promise.resolve();
      },
    };
    const ws = new WorkspaceService({
      createBackend: (bytes) => InProcessDbBackend.open(bytes),
      crypto: new CryptoService(),
      fs,
      deviceId: () => 'dev-new',
    });

    const summary = await ws.open({ path: 'mem://v1.swaft' });
    expect(summary.name).toBe('Old WS');

    // Version stamped to current.
    const version = await ws
      .requireAdapter()
      .get<Record<string, number>>('PRAGMA user_version');
    expect(version?.user_version).toBe(SCHEMA_VERSION);

    // Existing data preserved through the migration.
    const tree = await new OrganizationService(ws).getTree();
    expect(tree.projects.map((p) => p.name)).toEqual(['Legacy']);

    // New v2 tables are usable (settings created lazily on first access).
    const settings = await new SettingsService(ws).getSettings();
    expect(settings.executionMode).toBe('sandbox');
  });
});
