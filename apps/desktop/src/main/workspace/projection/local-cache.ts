import { LOCAL_ONLY_TABLES } from '../../storage/schema';
import type { Row } from '../../storage/sqlite';
import type { LocalAdapter } from '../LocalAdapter';
import type { DirFs } from './dir-fs';

/**
 * Persists the 🔵 local-only tables (history, run logs, input state, selections — never versioned,
 * see {@link import('./projection').dumpWorkspace}) into a single git-ignored file, so folder/git
 * workspaces keep this data across a close/reopen instead of losing it (open-standards plan §3.5).
 * `.gitignore` already reserves `/.swaft/` for exactly this (written by `FolderPersistence`/
 * `GitPersistence`). Read on open, written on save, alongside (not instead of) the versioned
 * projection tree. A missing or unreadable cache is treated as "nothing to restore", never an error —
 * this data was always best-effort/local, so it must never block opening or saving a workspace.
 */
const CACHE_FILE = '.swaft/local-cache.json';

export async function dumpLocalCache(adapter: LocalAdapter, fs: DirFs): Promise<void> {
  const data: Record<string, Row[]> = {};
  for (const table of LOCAL_ONLY_TABLES) {
    data[table] = await adapter.all(`SELECT * FROM ${table}`);
  }
  await fs.writeFile(CACHE_FILE, JSON.stringify(data));
}

export async function hydrateLocalCache(adapter: LocalAdapter, fs: DirFs): Promise<void> {
  const raw = await fs.readFile(CACHE_FILE);
  if (raw == null) return;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  if (data == null || typeof data !== 'object') return;
  for (const table of LOCAL_ONLY_TABLES) {
    const rows = (data as Record<string, unknown>)[table];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row == null || typeof row !== 'object') continue;
      const cols = Object.keys(row as Row);
      if (cols.length === 0) continue;
      const placeholders = cols.map(() => '?').join(', ');
      await adapter.run(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
        cols.map((c) => (row as Row)[c]),
      );
    }
  }
}
