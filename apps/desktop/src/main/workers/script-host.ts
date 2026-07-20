import type {
  ScriptErrorCode,
  ScriptHostMessage,
  ScriptRunReply,
  ScriptRunRequest,
} from '../usercode/contract';
import { findForbiddenSyntax, findNonJsonPath } from '../usercode/guard';

/**
 * The isolated script host: a dedicated Electron `utilityProcess` that imports and runs
 * user-authored capability modules (analisi_codice_utente.md §5.4). It is the process the main side
 * kills when a call outruns its budget, which is the only real defence against a non-terminating
 * capability — Seebo's own limits bound template evaluation, not the JavaScript we hand to it.
 *
 * What this process does and does not guarantee, stated plainly:
 *  - it isolates crashes, memory and CPU from the main process, and can be killed mid-loop;
 *  - it strips the ambient globals (`process`, `fetch`, timers over the network) before any user
 *    module is imported, so `Function('return process')()` yields undefined;
 *  - it does **not** stop a module that imports a Node built-in. That is what the static guard in
 *    `usercode/guard.ts` is for, and why the sandbox profile refuses imports outright.
 */

/** Captured before hardening: the port is how we talk to main once `process` is gone. */
const parentPort = process.parentPort;

/**
 * Rollup compiles this entry to CommonJS, where a literal `import()` would be rewritten to
 * `require()` — which cannot load a `data:` URL. Building the importer through `Function` keeps a
 * genuine dynamic import in the output.
 */
const dynamicImport = new Function('url', 'return import(url)') as (
  url: string,
) => Promise<Record<string, unknown>>;

/** Imported modules by content hash. Node also caches by URL; this skips re-encoding the source. */
const modules = new Map<string, Promise<Record<string, unknown>>>();
const MAX_CACHED_MODULES = 64;

/** Remove the ambient authority user code has no business reaching. Runs once, before any import. */
function harden(): void {
  const globals = globalThis as unknown as Record<string, unknown>;
  for (const name of ['process', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator']) {
    delete globals[name];
  }
}

const MAX_LOGS = 100;
const MAX_LOG_CHARS = 2000;

/** One run's collectable side outputs: log lines, and (actions only) requested env writes. */
interface Collector {
  logs: string[];
  envWrites: Record<string, string>;
}

/**
 * The `swaft` object handed to user code. Capabilities get a read-only view; actions additionally
 * get `env.set`, which only *records* the intent — the host applies the writes once the action has
 * succeeded, so a failure part-way cannot leave half the variables changed.
 */
function makeSwaft(req: ScriptRunRequest, out: Collector): unknown {
  const vars = Object.freeze({ ...req.env });
  const env: Record<string, unknown> = {
    /** The active environment's value for `name`, or undefined when it is not defined. */
    get: (name: string): string | undefined => vars[name],
    has: (name: string): boolean => Object.hasOwn(vars, name),
    keys: (): string[] => Object.keys(vars),
  };
  if (req.kind === 'action') {
    env.set = (name: string, value: unknown): void => {
      if (typeof name !== 'string' || !name.trim()) throw new Error('env.set needs a variable name');
      out.envWrites[name] = String(value);
    };
  }
  return Object.freeze({
    env: Object.freeze(env),
    /** ISO-8601 now. A `Date` could not cross back into the render state, so we hand over a string. */
    now: (): string => new Date().toISOString(),
    /** Debug output, returned with the run: user code has no console to write to. */
    log: (...parts: unknown[]): void => {
      if (out.logs.length >= MAX_LOGS) return;
      const line = parts.map(stringify).join(' ');
      out.logs.push(line.length > MAX_LOG_CHARS ? `${line.slice(0, MAX_LOG_CHARS)}…` : line);
    },
    /** True when the caller only wants to know what would happen (actions). */
    dryRun: req.dryRun === true,
  });
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function loadModule(req: ScriptRunRequest): Promise<Record<string, unknown>> {
  const cached = modules.get(req.hash);
  if (cached) return cached;
  const url = `data:text/javascript;base64,${Buffer.from(req.code, 'utf8').toString('base64')}`;
  const loading = dynamicImport(url);
  if (modules.size >= MAX_CACHED_MODULES) modules.clear();
  modules.set(req.hash, loading);
  // A module that fails to import must not stay cached as a rejected promise.
  loading.catch(() => modules.delete(req.hash));
  return loading;
}

async function run(req: ScriptRunRequest, out: Collector): Promise<unknown> {
  const rejected = findForbiddenSyntax(req.code, req.profile);
  if (rejected) throw new HostError('USER_CODE_REJECTED', rejected);

  let module: Record<string, unknown>;
  try {
    module = await loadModule(req);
  } catch (err) {
    throw new HostError('USER_CODE_LOAD_FAILED', messageOf(err));
  }

  // A dry run prefers the module's own `dryRun` export; without one the default runs with
  // `swaft.dryRun === true` and it is the author's job to honour it.
  const fn = (req.dryRun && typeof module.dryRun === 'function' ? module.dryRun : module.default) as
    | ((ctx: unknown) => unknown)
    | undefined;
  if (typeof fn !== 'function') {
    throw new HostError(
      'USER_CODE_REJECTED',
      req.kind === 'action'
        ? 'an action must `export default` a function taking ({ input, api, swaft })'
        : 'a capability must `export default` a function taking ({ args, swaft })',
    );
  }

  const swaft = makeSwaft(req, out);
  let value: unknown;
  try {
    value =
      req.kind === 'action'
        ? await fn({ input: req.args, api: req.api ?? null, swaft })
        : await fn({ args: req.args, swaft });
  } catch (err) {
    throw new HostError('USER_CODE_FAILED', messageOf(err));
  }

  // An action that returns nothing is fine — it ran for its effect. A capability must resolve.
  if (value === undefined) {
    if (req.kind === 'action') return null;
    throw new HostError(
      'USER_CODE_INVALID_RESULT',
      'returned undefined; a capability must resolve to a value',
    );
  }
  const badPath = findNonJsonPath(value);
  if (badPath) {
    throw new HostError(
      'USER_CODE_INVALID_RESULT',
      `returned a value that is not JSON at ${badPath} (only plain objects, arrays, strings, finite numbers, booleans and null can cross back)`,
    );
  }
  return value;
}

class HostError extends Error {
  constructor(
    readonly code: ScriptErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

harden();

parentPort.on('message', (event: { data: ScriptHostMessage }) => {
  const { id, run: request } = event.data;
  // Logs are collected even on failure — they are usually how the failure gets diagnosed.
  const out: Collector = { logs: [], envWrites: {} };
  void run(request, out).then(
    (value) =>
      parentPort.postMessage({
        id,
        ok: true,
        value,
        logs: out.logs,
        envWrites: out.envWrites,
      } satisfies ScriptRunReply),
    (err: unknown) =>
      parentPort.postMessage({
        id,
        ok: false,
        code: err instanceof HostError ? err.code : 'USER_CODE_FAILED',
        message: messageOf(err),
        logs: out.logs,
      } satisfies ScriptRunReply),
  );
});
