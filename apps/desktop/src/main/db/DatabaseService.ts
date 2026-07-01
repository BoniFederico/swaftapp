import type { DbEngine, DbResultDto } from '@swaft/shared';
import { AppError } from '../errors';
import { openSqliteDb } from '../storage/sqlite';
import { isReadOnlyQuery } from './readonly';

export interface DatabaseFs {
  read(path: string): Promise<Uint8Array | null>;
}

function normalizeCell(value: unknown): unknown {
  return value instanceof Uint8Array ? '<blob>' : value;
}

/**
 * Read-only-by-default database client (SWAFT_SECURITY_MODEL §10). Dangerous statements are blocked
 * by the classifier before any engine runs them. **SQLite** is executed via sql.js (WASM, no native
 * module — consistent with OD-M4-DB). **PostgreSQL** is a reserved adapter (a live `pg` driver is a
 * native module added in packaging); its statements are still classified/blocked here.
 */
export class DatabaseService {
  constructor(private readonly deps: { fs: DatabaseFs }) {}

  async query(input: { engine: DbEngine; file?: string; sql: string }): Promise<DbResultDto> {
    if (!isReadOnlyQuery(input.sql)) {
      throw new AppError(
        'STATEMENT_NOT_ALLOWED',
        'policy',
        'Only read-only queries are allowed (the database client is read-only by default).',
      );
    }
    if (input.engine === 'postgres') {
      throw new AppError(
        'ENGINE_NOT_AVAILABLE',
        'execution',
        'PostgreSQL is a reserved adapter (not available in this build).',
      );
    }
    if (!input.file) {
      throw new AppError('NO_CONNECTION', 'validation', 'No database file selected.');
    }

    const bytes = await this.deps.fs.read(input.file);
    if (!bytes) throw new AppError('DB_NOT_FOUND', 'not_found', 'Database file not found.');

    let db;
    try {
      db = await openSqliteDb(bytes);
    } catch {
      throw new AppError('INVALID_DB', 'validation', 'Not a valid SQLite database.');
    }
    try {
      const { columns, rows } = db.select(input.sql);
      return { columns, rows: rows.map((r) => r.map(normalizeCell)), rowCount: rows.length };
    } catch (e) {
      throw new AppError('QUERY_FAILED', 'execution', e instanceof Error ? e.message : 'Query failed.');
    } finally {
      db.close();
    }
  }
}
