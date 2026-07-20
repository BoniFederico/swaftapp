import { parseJsonOr } from '../util/json';

/** Best-effort HTTP method for an `api` template (its source is the JSON request model). */
export function extractHttpMethod(source: string): string | null {
  const parsed = parseJsonOr<unknown>(source, null);
  if (!parsed || typeof parsed !== 'object') return null;
  const method = (parsed as { method?: unknown }).method;
  return typeof method === 'string' ? method.toUpperCase() : null;
}
