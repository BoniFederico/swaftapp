/**
 * A tiny pub/sub so any component that mutates 🟢 organization data (e.g. the Template Editor saving
 * a source, renaming, or changing tags) can ask the Working Tree to re-fetch and reflect the change
 * in real time — without prop-drilling a refresh callback through the whole shell.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Notify every subscriber that the workspace tree changed and should be reloaded. */
export function notifyTreeChanged(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to tree-changed notifications; returns an unsubscribe function. */
export function subscribeTreeChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
