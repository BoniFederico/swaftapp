/**
 * Statement classifier: is a SQL string a **read-only** query? Defends the read-only-by-default DB
 * client (SWAFT_SECURITY_MODEL §10). Dialect-agnostic (SQLite + PostgreSQL): a single statement whose
 * leading keyword is read-only, with no write/DDL keyword anywhere (catches `WITH … DELETE`,
 * `SELECT … INTO`, stacked statements). This is one layer; a real read-only role/transaction is the
 * defence-in-depth added per engine.
 */
const READONLY_FIRST = new Set(['select', 'with', 'explain', 'show', 'values']);

const WRITE_KEYWORDS =
  /\b(insert|update|delete|drop|alter|truncate|create|replace|grant|revoke|attach|detach|vacuum|reindex|merge|into|call|copy|set|pragma|begin|commit|rollback)\b/i;

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // /* ... */
    .replace(/--[^\n]*/g, ' '); // -- ...
}

export function isReadOnlyQuery(sql: string): boolean {
  const cleaned = stripComments(sql).trim();
  if (!cleaned) return false;

  const statements = cleaned
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (statements.length !== 1) return false; // no stacked statements

  const stmt = statements[0]!;
  const first = (stmt.match(/^[a-zA-Z]+/)?.[0] ?? '').toLowerCase();
  if (!READONLY_FIRST.has(first)) return false;

  return !WRITE_KEYWORDS.test(stmt);
}
