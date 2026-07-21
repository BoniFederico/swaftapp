/**
 * Deterministic JSON for versioned workspace files: object keys are sorted recursively, arrays keep
 * their order, and the document is pretty-printed with a trailing newline. Stable output is what
 * makes the files diff cleanly and merge with minimal conflicts (git.md §4.1) — the same logical
 * content always serializes to the same bytes, regardless of insertion order.
 */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
