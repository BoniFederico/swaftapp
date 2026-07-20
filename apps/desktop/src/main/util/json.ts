/**
 * Tolerant JSON readers for persisted columns and wire bodies. The convention everywhere in the
 * main process is that a malformed JSON column yields a safe default, never an exception — the
 * data may come from older schema versions or other devices.
 */

/** Parse JSON, or return `fallback` when the text is empty or malformed. */
export function parseJsonOr<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Parse a JSON object of values into a string→string map (values coerced with `String`). */
export function parseStringMap(raw: string | null | undefined): Record<string, string> {
  const value = parseJsonOr<unknown>(raw, null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = String(v);
  return out;
}

/** Parse a JSON array into a string list (items coerced with `String`). */
export function parseStringList(raw: string | null | undefined): string[] {
  const value = parseJsonOr<unknown>(raw, null);
  return Array.isArray(value) ? value.map(String) : [];
}
