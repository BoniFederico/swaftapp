/**
 * Wire contract between the main process and the isolated script host that runs user-authored
 * JavaScript. Kept free of Electron and of any service import so
 * both sides — and the tests — can depend on it.
 *
 * Every message is plain JSON: the process boundary and Seebo's own sanitization (which accepts only
 * JSON values back into the render state) impose the same constraint, so honouring it here means a
 * capability can never hand back something the engine would later reject.
 */

/**
 * How much ambient authority user code gets. `sandbox` is the only profile implemented today; the
 * `developer` unlocks (module allow-list, HTTP through HttpService, bounded file writes) land in a
 * later phase, and the guard deliberately refuses to be lenient until then.
 */
export type ScriptProfile = 'sandbox' | 'developer';

/**
 * What kind of user code this is. The two differ in what they are handed and what they may do:
 * a capability resolves data and must stay pure, an action is the effect channel and may write.
 */
export type ScriptKind = 'capability' | 'action';

/** An invocation: the compiled module plus what the caller passes in. */
export interface ScriptRunRequest {
  /** Capability/action name, used for error messages and module identity. */
  name: string;
  kind: ScriptKind;
  /** The module source (the template's effective source). */
  code: string;
  /** Content hash — lets the host reuse an already-imported module without re-parsing. */
  hash: string;
  profile: ScriptProfile;
  /** Descriptor fields of the call, minus the engine's own keys (see `capabilityArgs`). */
  args: Record<string, unknown>;
  /** Snapshot of the active environment, so `swaft.env.get` stays synchronous inside user code. */
  env: Record<string, string>;
  /** Actions only: the request (and, after a send, the response) the action operates on. */
  api?: unknown;
  /** Actions only: a dry run must describe what it would do instead of doing it. */
  dryRun?: boolean;
}

/** Everything one run produced besides its return value. */
export interface ScriptRunOutcome {
  value: unknown;
  /** Lines the code emitted with `swaft.log(...)`, in order. */
  logs: string[];
  /**
   * Environment writes an action asked for, applied by the host **after** it succeeds — a failure
   * half-way must not leave half the variables changed.
   */
  envWrites: Record<string, string>;
}

/** What the host reports back for one run. */
export type ScriptRunReply =
  | ({ id: number; ok: true } & ScriptRunOutcome)
  | { id: number; ok: false; code: ScriptErrorCode; message: string; logs: string[] };

/**
 * A call the isolated process makes *back* into main, for the things it must not do itself. The
 * developer profile's HTTP goes through here so `HttpService` still applies the workspace policy —
 * blocked domains, enforced headers, redirect re-validation. A raw `fetch` in the host would bypass
 * all of it, which is why none is provided.
 */
export interface HostCall {
  id: number;
  method: 'http';
  payload: unknown;
}
export type HostCallReply =
  | { hostReply: { id: number; ok: true; value: unknown } }
  /** `code` is the app error code (e.g. DOMAIN_NOT_ALLOWED), so the author sees why, not just that. */
  | { hostReply: { id: number; ok: false; message: string; code?: string } };

/** Messages main → host: a run request, or the answer to a call the host made. */
export type ScriptHostMessage = { id: number; run: ScriptRunRequest } | HostCallReply;

/** Messages host → main: the result of a run, or a call it needs main to make. */
export type ScriptHostOutbound = ScriptRunReply | { hostCall: HostCall };

/**
 * Modules the **developer** profile may import. Deliberately computation-only: anything that can
 * reach the outside world (fs, net, child_process, http) is absent, because those effects must go
 * through the `swaft` bridges where the workspace policy is applied.
 */
export const DEVELOPER_MODULE_ALLOWLIST = [
  'node:crypto',
  'node:url',
  'node:querystring',
  'node:util',
  'node:buffer',
  'node:string_decoder',
  'node:punycode',
  'node:zlib',
] as const;

export const SCRIPT_ERROR_CODES = [
  /** The source is rejected before it ever runs (imports in sandbox, unusable export shape…). */
  'USER_CODE_REJECTED',
  /** The module threw while being imported. */
  'USER_CODE_LOAD_FAILED',
  /** The capability function threw. */
  'USER_CODE_FAILED',
  /** The capability returned something that is not JSON (a function, a Date, a cycle…). */
  'USER_CODE_INVALID_RESULT',
  /** The call outran its budget; the host process was killed to stop it. */
  'USER_CODE_TIMEOUT',
  /** The host died (crash, OOM) or could not be started. */
  'USER_CODE_HOST_UNAVAILABLE',
] as const;
export type ScriptErrorCode = (typeof SCRIPT_ERROR_CODES)[number];

/** Default per-call budget, aligned with Seebo's own driver `timeoutMs` so the two agree. */
export const DEFAULT_SCRIPT_TIMEOUT_MS = 2000;

/** Base Seebo types a capability may contract for; `object` is the default (structured data). */
export const CAPABILITY_TYPES = [
  'string',
  'int',
  'float',
  'bool',
  'datetime',
  'duration',
  'object',
  'array',
] as const;
export const DEFAULT_CAPABILITY_TYPE = 'object';
