import { utilityProcess, type UtilityProcess } from 'electron';
import {
  DEFAULT_SCRIPT_TIMEOUT_MS,
  type ScriptRunReply,
  type ScriptRunRequest,
} from './contract';
import { scriptError, type ScriptRuntime } from './ScriptRuntime';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  name: string;
}

/**
 * Runs user capabilities in a dedicated `utilityProcess`, spawned lazily on first use and kept warm
 * for the session — spawning costs tens of milliseconds, and renders are frequent enough that a
 * process per call would be felt while typing (analisi_codice_utente.md §5.4, §6).
 *
 * A call that outruns its budget cannot be interrupted from inside (the host's event loop is blocked
 * by the very code we want to stop), so the timeout **kills the process**. Everything in flight is
 * failed with the same error and the next call spawns a fresh host. One process serves all
 * capabilities: the boundary that matters is user code ↔ main, not capability ↔ capability.
 */
export class UtilityProcessRuntime implements ScriptRuntime {
  private child: UtilityProcess | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly modulePath: string,
    private readonly timeoutMs: number = DEFAULT_SCRIPT_TIMEOUT_MS,
  ) {}

  run(request: ScriptRunRequest): Promise<unknown> {
    const child = this.ensureChild();
    const id = ++this.seq;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        // The host is wedged inside user code; only killing it frees us.
        this.failAll(
          scriptError(
            'USER_CODE_TIMEOUT',
            `did not finish within ${this.timeoutMs}ms and was stopped`,
            request.name,
          ),
        );
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, name: request.name });
      child.postMessage({ id, run: request });
    });
  }

  async dispose(): Promise<void> {
    this.failAll(scriptError('USER_CODE_HOST_UNAVAILABLE', 'the script host was shut down'));
    this.child?.kill();
    this.child = null;
  }

  private ensureChild(): UtilityProcess {
    if (this.child) return this.child;
    const child = utilityProcess.fork(this.modulePath, [], {
      serviceName: 'swaft-script-host',
      // No stdio piping: user code has nothing to say on stdout that we want to collect.
      stdio: 'ignore',
    });
    child.on('message', (message: ScriptRunReply) => this.settle(message));
    child.on('exit', () => {
      this.child = null;
      this.failAll(scriptError('USER_CODE_HOST_UNAVAILABLE', 'the script host stopped unexpectedly'));
    });
    this.child = child;
    return child;
  }

  private settle(reply: ScriptRunReply): void {
    const entry = this.pending.get(reply.id);
    if (!entry) return;
    this.pending.delete(reply.id);
    clearTimeout(entry.timer);
    if (reply.ok) entry.resolve(reply.value);
    else entry.reject(scriptError(reply.code, reply.message, entry.name));
  }

  /** Fail every in-flight call and drop the host, so the next call starts from a clean process. */
  private failAll(err: Error): void {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    this.pending.clear();
    if (this.child) {
      const child = this.child;
      this.child = null;
      child.kill();
    }
  }
}
