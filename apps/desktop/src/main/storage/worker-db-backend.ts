import { Worker } from 'node:worker_threads';
import type { Row, SqlParam } from './sqlite';
import {
  InProcessDbBackend,
  type DbBackend,
  type DbCommand,
  type DbResult,
} from './db-backend';

/**
 * DbBackend that runs the database inside a dedicated worker thread. The synchronous sql.js work
 * never touches the main thread; commands are sent over `postMessage` and results returned by id.
 */
type Reply =
  | { ready: true }
  | { id: number; ok: true; result: DbResult }
  | { id: number; ok: false; error: string };

export class WorkerDbBackend implements DbBackend {
  private seq = 0;
  /** Set once the worker errors or exits; from then on every call fails fast instead of hanging. */
  private failure: Error | null = null;
  private readonly pending = new Map<
    number,
    { resolve: (v: DbResult) => void; reject: (e: Error) => void }
  >();

  private constructor(private readonly worker: Worker) {
    worker.on('message', (msg: Reply) => {
      if ('ready' in msg) return;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.ok) entry.resolve(msg.result);
      else entry.reject(new Error(msg.error));
    });
    worker.on('error', (err) => this.markDead(err));
    worker.on('exit', (code) => this.markDead(new Error(`DB worker exited with code ${code}`)));
  }

  /** A dead worker can never answer: reject everything in flight and tear the thread down. */
  private markDead(err: Error): void {
    if (!this.failure) this.failure = err;
    this.failAll(this.failure);
    void this.worker.terminate().catch(() => undefined);
  }

  /** Spawn the worker and resolve once it signals readiness (or reject on early failure/timeout). */
  static open(workerFile: string, bytes?: Uint8Array, readyTimeoutMs = 5000): Promise<WorkerDbBackend> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerFile, { workerData: { bytes } });
      const timer = setTimeout(() => {
        worker.terminate().catch(() => {});
        reject(new Error('DB worker did not become ready in time'));
      }, readyTimeoutMs);
      const onReady = (msg: Reply) => {
        if ('ready' in msg) {
          clearTimeout(timer);
          worker.off('message', onReady);
          worker.off('error', onError);
          resolve(new WorkerDbBackend(worker));
        }
      };
      const onError = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
      worker.on('message', onReady);
      worker.once('error', onError);
    });
  }

  private failAll(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  private send(cmd: DbCommand): Promise<DbResult> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.seq;
    return new Promise<DbResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, cmd });
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async run(sql: string, params: SqlParam[] = []): Promise<void> {
    await this.send({ kind: 'run', sql, params });
  }
  async all<T = Row>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return (await this.send({ kind: 'all', sql, params })) as T[];
  }
  async get<T = Row>(sql: string, params: SqlParam[] = []): Promise<T | null> {
    return (await this.send({ kind: 'get', sql, params })) as T | null;
  }
  async exec(sql: string): Promise<void> {
    await this.send({ kind: 'exec', sql });
  }
  async userVersion(): Promise<number> {
    return (await this.send({ kind: 'userVersion' })) as number;
  }
  async setUserVersion(version: number): Promise<void> {
    await this.send({ kind: 'setUserVersion', version });
  }
  async serialize(): Promise<Uint8Array> {
    return (await this.send({ kind: 'serialize' })) as Uint8Array;
  }
  async close(): Promise<void> {
    try {
      if (!this.failure) await this.send({ kind: 'close' });
    } finally {
      await this.worker.terminate();
    }
  }
}

/**
 * Create the production DB backend: prefer the worker (off-main-thread), but fall back to the
 * in-process backend if the worker cannot be spawned (keeps the app usable; the worker path is the
 * one validated for performance in M11). When `workerFile` is omitted, runs in-process.
 */
export async function createDbBackend(opts: {
  workerFile?: string;
  bytes?: Uint8Array;
}): Promise<DbBackend> {
  if (opts.workerFile) {
    try {
      return await WorkerDbBackend.open(opts.workerFile, opts.bytes);
    } catch (err) {
      console.warn('[swaft] DB worker unavailable; using in-process backend:', err);
    }
  }
  return InProcessDbBackend.open(opts.bytes);
}
