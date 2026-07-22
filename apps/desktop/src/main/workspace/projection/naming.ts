/**
 * Hybrid on-disk naming (open-standards plan D2): a workspace file/dir is named `<slug>.<shortId>`
 * so the tree is browsable *and* rename-stable, while the full, canonical id lives **inside** the
 * file. The loader keys entities off the in-file id, never the path, so a rename is a pure move and
 * two entities can never collide (distinct ids → distinct short ids).
 *
 * These functions are deterministic and side-effect free (no clock, no RNG) so a given DB always
 * dumps to the exact same names — a prerequisite for meaningful git diffs.
 */

/** Length of the disambiguating id suffix; 8 hex chars keep per-workspace collisions negligible. */
const SHORT_ID_LEN = 8;

/** Fallback slug for an entity whose name has no slug-able characters (e.g. "  " or "***"). */
const EMPTY_SLUG = 'untitled';

/** Max slug length, so a long name can't produce an unwieldy path. */
const MAX_SLUG_LEN = 48;

/**
 * A filesystem-safe, lowercase, dash-separated slug of a human name. ASCII-folds nothing (kept
 * dependency-free); any run of non `[a-z0-9]` becomes a single dash, leading/trailing dashes are
 * trimmed. Empty results fall back to {@link EMPTY_SLUG}.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LEN)
    .replace(/-+$/g, '');
  return slug || EMPTY_SLUG;
}

/** The short, path-facing form of an id: its first hex chars, dashes stripped (`a1b2c3d4`). */
export function shortId(id: string): string {
  const compact = id.replace(/[^a-zA-Z0-9]/g, '');
  return (compact || id).slice(0, SHORT_ID_LEN).toLowerCase();
}

/** The `<slug>.<shortId>` base name (no extension) for an entity. */
export function entityBaseName(name: string, id: string): string {
  return `${slugify(name)}.${shortId(id)}`;
}
