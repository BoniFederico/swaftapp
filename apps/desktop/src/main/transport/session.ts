/**
 * Session gate consulted by the dispatcher's session guard. Kept transport-agnostic and free of any
 * Electron import so `dispatch` stays portable across hosts.
 *
 * This is a **host-agnostic seam**, not dead code: the desktop app has no login, so the gate is left
 * open (`isSignedIn: () => true`); a future hosted backend (SWAFT_ARCHITECTURE.md §12) injects a gate
 * backed by real per-request sessions via {@link setSessionGate}. Tests may inject their own gate.
 */
export interface SessionGate {
  isSignedIn(): boolean;
}

let gate: SessionGate = { isSignedIn: () => true };

export function setSessionGate(next: SessionGate): void {
  gate = next;
}

export function isSignedIn(): boolean {
  return gate.isSignedIn();
}
