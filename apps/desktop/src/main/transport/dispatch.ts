import {
  isError,
  makeError,
  ok,
  requiresSession,
  validateOpRequest,
  type OpName,
  type ResultEnvelope,
} from '@swaft/shared';
import { handlers } from './handlers';
import { isSignedIn } from './session';

/**
 * Transport-agnostic op dispatch. The IPC router (and a future HTTP server) both call this.
 * It (1) checks the op is known, (2) enforces the **session guard** (non-public ops require an
 * active session — SWAFT_SECURITY_MODEL.md §3a), (3) **validates the payload against the op's
 * request schema before any handler runs** (IPC-5), (4) runs the handler, and (5) maps failures to
 * the error envelope. No business logic lives here — handlers hold it.
 */
export async function dispatch(op: string, payload: unknown): Promise<ResultEnvelope<unknown>> {
  const handler = handlers[op as OpName];
  if (!handler) {
    return makeError('UNKNOWN_OP', 'not_found', `Unknown op: ${op}`);
  }

  // Session guard (fail-closed): session-required ops are rejected without an active session.
  if (requiresSession(op as OpName) && !isSignedIn()) {
    return makeError('NO_SESSION', 'auth', 'Authentication required');
  }

  const validation = validateOpRequest(op as OpName, payload);
  if (!validation.ok) {
    return makeError('INVALID_PAYLOAD', 'validation', `Invalid request for ${op}`, {
      issues: validation.issues,
    });
  }

  try {
    const result = await handler(validation.data);
    // Handlers may return an error envelope directly, or raw data.
    if (result && typeof result === 'object' && isError(result as ResultEnvelope<unknown>)) {
      return result as ResultEnvelope<unknown>;
    }
    return ok(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return makeError('INTERNAL', 'internal', message);
  }
}
