import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

/**
 * SQLite engine for `.swaft` workspaces. We use **sql.js (SQLite compiled to WASM)** rather than a
 * native driver (better-sqlite3): pure WASM means identical behaviour in the Electron main process,
 * worker threads, and Node test runners with **no native build / ABI concerns** — consistent with
 * the Argon2id (hash-wasm) decision. The DB is an in-memory image serialized to bytes for the
 * `.swaft` file; whole-file encryption wraps those bytes (see CryptoService). better-sqlite3 remains
 * a reserved future swap behind the repository/DbBackend interfaces. (Resolved OD-M4-DB.)
 *
 * sql.js is synchronous and CPU-bound, so production runs it on a dedicated worker (see DbBackend) to
 * keep the main thread responsive.
 */

export type SqlValue = string | number | Uint8Array | null;
export type SqlParam = SqlValue;
export type Row = Record<string, SqlValue>;

let sqlPromise: Promise<SqlJsStatic> | null = null;

/** Locate + read the sql.js WASM binary across env shapes (ESM/Vitest and CJS/Electron worker). */
function loadWasmBinary(): ArrayBuffer {
  const errors: string[] = [];
  const tryResolve = (resolver: (id: string) => string): ArrayBuffer | null => {
    try {
      const buf = readFileSync(resolver('sql.js/dist/sql-wasm.wasm'));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  // ESM / Vitest: createRequire(import.meta.url). Guarded because import.meta is absent in CJS.
  let fromImportMeta: ArrayBuffer | null = null;
  try {
    const req = createRequire(import.meta.url);
    fromImportMeta = tryResolve((id) => req.resolve(id));
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  if (fromImportMeta) return fromImportMeta;

  // CJS / Electron: the ambient require is available.
  if (typeof require !== 'undefined') {
    const fromRequire = tryResolve((id) => require.resolve(id));
    if (fromRequire) return fromRequire;
  }

  throw new Error(`Unable to locate sql.js WASM: ${errors.join('; ')}`);
}

/** Lazily initialize (and cache) the sql.js module with the embedded WASM. */
function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ wasmBinary: loadWasmBinary() });
  }
  return sqlPromise;
}

/**
 * Thin synchronous wrapper around a sql.js `Database`. All `.swaft` SQL flows through this so the
 * DbBackend (in-process or worker) has one surface to call.
 */
export class SqliteDb {
  constructor(private readonly db: Database) {}

  /** Execute a single statement that returns no rows. */
  run(sql: string, params: SqlParam[] = []): void {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params as never);
      stmt.step();
    } finally {
      stmt.free();
    }
  }

  /** Run a query and return all rows as objects. */
  all<T = Row>(sql: string, params: SqlParam[] = []): T[] {
    const stmt = this.db.prepare(sql);
    const rows: T[] = [];
    try {
      stmt.bind(params as never);
      while (stmt.step()) rows.push(stmt.getAsObject() as unknown as T);
    } finally {
      stmt.free();
    }
    return rows;
  }

  /** Run a query and return the first row, or null. */
  get<T = Row>(sql: string, params: SqlParam[] = []): T | null {
    return this.all<T>(sql, params)[0] ?? null;
  }

  /** Execute one or more statements (DDL/scripts) with no result handling. */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /** Run a query returning the raw columns + row tuples (for the Database View). */
  select(sql: string): { columns: string[]; rows: SqlValue[][] } {
    const result = this.db.exec(sql);
    const first = result[0];
    if (!first) return { columns: [], rows: [] };
    return { columns: first.columns, rows: first.values as SqlValue[][] };
  }

  /** The `.swaft` schema version, stored in SQLite's `user_version` pragma. */
  userVersion(): number {
    const res = this.db.exec('PRAGMA user_version');
    return Number(res[0]?.values[0]?.[0] ?? 0);
  }

  setUserVersion(version: number): void {
    this.db.run(`PRAGMA user_version = ${Math.trunc(version)}`);
  }

  /** Serialize the whole database image to bytes (the `.swaft` payload before optional encryption). */
  export(): Uint8Array {
    return this.db.export();
  }

  close(): void {
    this.db.close();
  }
}

/** Open a SqliteDb from existing bytes, or create an empty one when `bytes` is omitted. */
export async function openSqliteDb(bytes?: Uint8Array): Promise<SqliteDb> {
  const SQL = await getSql();
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  return new SqliteDb(db);
}
