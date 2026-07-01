import { OP_NAMES, type OpName } from '@swaft/shared';

/**
 * The single source of truth for which IPC channels (ops) the renderer may invoke.
 * Two layers of enforcement: the router checks the **op allow-list** (ALLOWED_OPS); the dispatcher
 * checks the **session guard** via `requiresSession()` from the shared contract — every non-public op
 * requires an active session (M3). See SWAFT_ARCHITECTURE.md §5, SWAFT_SECURITY_MODEL.md §3 / §3a.
 */

/** The single IPC channel carrying all ops; the op name travels in the payload and is allow-listed. */
export const IPC_INVOKE_CHANNEL = 'swaft:invoke';

/** Allow-list of op names callable from the renderer. */
export const ALLOWED_OPS: ReadonlySet<OpName> = new Set(OP_NAMES);

export function isAllowedOp(name: string): name is OpName {
  return (ALLOWED_OPS as Set<string>).has(name);
}
