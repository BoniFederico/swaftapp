import { utilityProcess, type UtilityProcess } from 'electron';
import {
  DEFAULT_SCRIPT_TIMEOUT_MS,
  type HostCall,
  type ScriptHostOutbound,
  type ScriptRunOutcome,
  type ScriptRunRequest,
} from './contract';
import { AppError } from '../errors';
import { scriptError, type ScriptRuntime } from './ScriptRuntime';

/**
 * What the isolated process may ask main to do on its behalf. Kept as a narrow injected interface
 * so the runtime does not reach for services itself, and so a test can watch what was asked.
 */
export interface HostBridge {
  http(payload: unknown): Promise<unknown>;
}

interface Pending {
  resolve: (value: ScriptRunOutcome) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  name: string;
}

/**
 * Runs user capabilities in a dedicated `utilityProcess`, spawned lazily on first use and kept warm
 * for the session — spawning costs tens of milliseconds, and renders are frequent enough that a
 * process per call would be felt while typing.
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
    private readonly bridge: HostBridge,
    private readonly timeoutMs: number = DEFAULT_SCRIPT_TIMEOUT_MS,
  ) {}

  run(request: ScriptRunRequest): Promise<ScriptRunOutcome> {
    const child = this.ensureChild();
    const id = ++this.seq;
    return new Promise<ScriptRunOutcome>((resolve, reject) => {
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
    child.on('message', (message: ScriptHostOutbound) => {
      if ('hostCall' in message) void this.serve(child, message.hostCall);
      else this.settle(message);
    });
    child.on('exit', () => {
      // A process killed after a timeout exits late, when a replacement may already be running:
      // only the current child's exit may clear it and fail the pending calls.
      if (this.child !== child) return;
      this.child = null;
      this.failAll(scriptError('USER_CODE_HOST_UNAVAILABLE', 'the script host stopped unexpectedly'));
    });
    this.child = child;
    return child;
  }

  /**
   * Answer a call the isolated process made. Anything the user's code wants from the outside world
   * arrives here, so this is where it meets the services that police it — never in the host.
   */
  private async serve(child: UtilityProcess, call: HostCall): Promise<void> {
    try {
      const value = await this.bridge[call.method](call.payload);
      child.postMessage({ hostReply: { id: call.id, ok: true, value } });
    } catch (err) {
      // Keep the coded reason: "DOMAIN_NOT_ALLOWED" tells the author what to change, a bare
      // "request failed" does not.
      const code = err instanceof AppError ? err.code : undefined;
      child.postMessage({
        hostReply: {
          id: call.id,
          ok: false,
          code,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  private settle(reply: Extract<ScriptHostOutbound, { id: number }>): void {
    const entry = this.pending.get(reply.id);
    if (!entry) return;
    this.pending.delete(reply.id);
    clearTimeout(entry.timer);
    if (reply.ok) {
      entry.resolve({ value: reply.value, logs: reply.logs, envWrites: reply.envWrites });
    } else {
      // Logs travel with the failure too: they are usually how the author diagnoses it.
      entry.reject(scriptError(reply.code, reply.message, entry.name, reply.logs));
    }
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
