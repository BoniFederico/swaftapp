import { parentPort, workerData } from 'node:worker_threads';
import { openSqliteDb } from '../storage/sqlite';
import { applyDbCommand, type DbCommand } from '../storage/db-backend';

/**
 * Dedicated DB worker. Owns a single sql.js database (opened from the optional initial bytes) and
 * applies serialized {@link DbCommand}s sent by {@link WorkerDbBackend}. Keeps the synchronous,
 * CPU-bound WASM work off the main thread (Architecture OD-A8). The command→DB mapping is the shared
 * `applyDbCommand`, so worker and in-process backends behave identically.
 */
interface Request {
  id: number;
  cmd: DbCommand;
}

async function main(): Promise<void> {
  const port = parentPort;
  if (!port) return;

  const { bytes } = (workerData ?? {}) as { bytes?: Uint8Array };
  const db = await openSqliteDb(bytes);

  port.on('message', (msg: Request) => {
    try {
      const result = applyDbCommand(db, msg.cmd);
      port.postMessage({ id: msg.id, ok: true, result });
    } catch (e) {
      port.postMessage({ id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  port.postMessage({ ready: true });
}

void main();
