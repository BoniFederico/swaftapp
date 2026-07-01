/**
 * Session gate consulted by the dispatcher's session guard. Kept transport-agnostic and free of any
 * Electron/AuthService import so `dispatch` stays portable to the renderer test bundle. The main
 * bootstrap (and tests) inject a gate backed by the AuthService. Default: no session (fail-closed).
 */
export interface SessionGate {
  isSignedIn(): boolean;
}

let gate: SessionGate = { isSignedIn: () => false };

export function setSessionGate(next: SessionGate): void {
  gate = next;
}

export function isSignedIn(): boolean {
  return gate.isSignedIn();
}
