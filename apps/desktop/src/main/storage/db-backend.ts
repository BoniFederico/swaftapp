import { openSqliteDb, SqliteDb, type Row, type SqlParam } from './sqlite';

/**
 * Async database boundary. Repositories/services depend ONLY on this interface, so the concrete
 * execution strategy is swappable: tests use {@link InProcessDbBackend}; production uses the
 * worker-thread backend (keeping sql.js's synchronous, CPU-bound work off the main thread). The
 * command set is intentionally small and serializable so it survives a `postMessage` round-trip.
 */
export interface DbBackend {
  run(sql: string, params?: SqlParam[]): Promise<void>;
  all<T = Row>(sql: string, params?: SqlParam[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: SqlParam[]): Promise<T | null>;
  exec(sql: string): Promise<void>;
  userVersion(): Promise<number>;
  setUserVersion(version: number): Promise<void>;
  /** Serialize the current DB image (the `.swaft` payload before optional encryption). */
  serialize(): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** Serializable DB command (also used as the worker RPC message). */
export type DbCommand =
  | { kind: 'run'; sql: string; params?: SqlParam[] }
  | { kind: 'all'; sql: string; params?: SqlParam[] }
  | { kind: 'get'; sql: string; params?: SqlParam[] }
  | { kind: 'exec'; sql: string }
  | { kind: 'userVersion' }
  | { kind: 'setUserVersion'; version: number }
  | { kind: 'serialize' }
  | { kind: 'close' };

export type DbResult = void | Row[] | Row | null | number | Uint8Array;

/**
 * Apply a command against a SqliteDb. Pure mapping (no transport), shared by the in-process backend
 * and the worker so both behave identically and can be unit-tested without spawning a worker.
 */
export function applyDbCommand(db: SqliteDb, cmd: DbCommand): DbResult {
  switch (cmd.kind) {
    case 'run':
      return db.run(cmd.sql, cmd.params ?? []);
    case 'all':
      return db.all<Row>(cmd.sql, cmd.params ?? []);
    case 'get':
      return db.get<Row>(cmd.sql, cmd.params ?? []);
    case 'exec':
      return db.exec(cmd.sql);
    case 'userVersion':
      return db.userVersion();
    case 'setUserVersion':
      return db.setUserVersion(cmd.version);
    case 'serialize':
      return db.export();
    case 'close':
      return db.close();
  }
}

/** Runs the DB on the calling thread. Used by tests and as a fallback when no worker is available. */
export class InProcessDbBackend implements DbBackend {
  constructor(private readonly db: SqliteDb) {}

  static async open(bytes?: Uint8Array): Promise<InProcessDbBackend> {
    return new InProcessDbBackend(await openSqliteDb(bytes));
  }

  run(sql: string, params: SqlParam[] = []): Promise<void> {
    return Promise.resolve(applyDbCommand(this.db, { kind: 'run', sql, params }) as void);
  }
  all<T = Row>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return Promise.resolve(applyDbCommand(this.db, { kind: 'all', sql, params }) as T[]);
  }
  get<T = Row>(sql: string, params: SqlParam[] = []): Promise<T | null> {
    return Promise.resolve(applyDbCommand(this.db, { kind: 'get', sql, params }) as T | null);
  }
  exec(sql: string): Promise<void> {
    return Promise.resolve(applyDbCommand(this.db, { kind: 'exec', sql }) as void);
  }
  userVersion(): Promise<number> {
    return Promise.resolve(applyDbCommand(this.db, { kind: 'userVersion' }) as number);
  }
  setUserVersion(version: number): Promise<void> {
    return Promise.resolve(applyDbCommand(this.db, { kind: 'setUserVersion', version }) as void);
  }
  serialize(): Promise<Uint8Array> {
    return Promise.resolve(applyDbCommand(this.db, { kind: 'serialize' }) as Uint8Array);
  }
  close(): Promise<void> {
    return Promise.resolve(applyDbCommand(this.db, { kind: 'close' }) as void);
  }
}
