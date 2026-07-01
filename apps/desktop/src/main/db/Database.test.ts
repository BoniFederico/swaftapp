import { describe, it, expect } from 'vitest';
import { openSqliteDb } from '../storage/sqlite';
import { DatabaseService } from './DatabaseService';
import { toCsv, toJson } from './export';
import { isReadOnlyQuery } from './readonly';

async function makeDb(): Promise<Uint8Array> {
  const db = await openSqliteDb();
  db.exec(`CREATE TABLE users (id INTEGER, name TEXT); INSERT INTO users VALUES (1, 'Ada'), (2, 'Lin');`);
  const bytes = db.export();
  db.close();
  return bytes;
}

describe('read-only classifier', () => {
  it('allows read-only statements', () => {
    expect(isReadOnlyQuery('SELECT * FROM t')).toBe(true);
    expect(isReadOnlyQuery('WITH x AS (SELECT 1) SELECT * FROM x')).toBe(true);
    expect(isReadOnlyQuery('EXPLAIN SELECT 1')).toBe(true);
  });

  it('blocks writes/DDL for both SQLite and Postgres syntax', () => {
    const dangerous = [
      'DELETE FROM t',
      'DROP TABLE t',
      'UPDATE t SET x = 1',
      'INSERT INTO t VALUES (1)',
      'ALTER TABLE t ADD c int',
      'TRUNCATE t',
      'CREATE TABLE t (x int)',
      'WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x', // pg writable CTE
      'SELECT 1; DROP TABLE t', // stacked
      'SELECT * INTO new_t FROM t', // SELECT INTO writes
    ];
    for (const sql of dangerous) expect(isReadOnlyQuery(sql), sql).toBe(false);
  });
});

describe('DatabaseService', () => {
  it('runs a read-only SELECT on a SQLite file (virtualized result shape)', async () => {
    const files = new Map([['mem://x.db', await makeDb()]]);
    const svc = new DatabaseService({ fs: { read: (p) => Promise.resolve(files.get(p) ?? null) } });
    const res = await svc.query({ engine: 'sqlite', file: 'mem://x.db', sql: 'SELECT name FROM users ORDER BY id' });
    expect(res.columns).toEqual(['name']);
    expect(res.rows).toEqual([['Ada'], ['Lin']]);
    expect(res.rowCount).toBe(2);
  });

  it('blocks a DELETE with a coded error before touching the database', async () => {
    const svc = new DatabaseService({ fs: { read: () => Promise.resolve(new Uint8Array()) } });
    await expect(
      svc.query({ engine: 'sqlite', file: 'x', sql: 'DELETE FROM users' }),
    ).rejects.toMatchObject({ code: 'STATEMENT_NOT_ALLOWED' });
  });

  it('reports PostgreSQL as a reserved adapter', async () => {
    const svc = new DatabaseService({ fs: { read: () => Promise.resolve(null) } });
    await expect(svc.query({ engine: 'postgres', sql: 'SELECT 1' })).rejects.toMatchObject({
      code: 'ENGINE_NOT_AVAILABLE',
    });
  });
});

describe('result export', () => {
  it('serializes CSV with escaping', () => {
    expect(toCsv(['a', 'b'], [[1, 'x,y'], [2, 'q"z']])).toBe('a,b\n1,"x,y"\n2,"q""z"');
  });
  it('serializes JSON records', () => {
    expect(JSON.parse(toJson(['a', 'b'], [[1, 'x']]))).toEqual([{ a: 1, b: 'x' }]);
  });
});
