/**
 * Wire contract between the main process and the isolated script host that runs user-authored
 * JavaScript (see analisi_codice_utente.md §5.4). Kept free of Electron and of any service import so
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

/** A capability invocation: the compiled module plus the descriptor fields the formula passed. */
export interface ScriptRunRequest {
  /** Capability name, used for error messages and module identity. */
  name: string;
  /** The module source (the template's effective source). */
  code: string;
  /** Content hash — lets the host reuse an already-imported module without re-parsing. */
  hash: string;
  profile: ScriptProfile;
  /** Descriptor fields of the call, minus the engine's own keys (see `capabilityArgs`). */
  args: Record<string, unknown>;
  /** Snapshot of the active environment, so `swaft.env.get` stays synchronous inside user code. */
  env: Record<string, string>;
}

/** What the host reports back for one run. */
export type ScriptRunReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; code: ScriptErrorCode; message: string };

/** Messages main → host. `ready` flows the other way at startup. */
export type ScriptHostMessage = { id: number; run: ScriptRunRequest };

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
