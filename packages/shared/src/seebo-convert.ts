/**
 * Export-time conversion of Seebo `${ … }` formulas at the boundary to a foreign format
 * (open-standards plan §6.2). The codecs (toPostman/toBruno/toHttpFile) serialize **verbatim**; the
 * export flow applies one of these strategies first, per the user's choice in the conversion dialog:
 *
 *  - **variabilize** — `env('X')` and the bare `${ X }` become `{{X}}` (understood by Postman/Bruno/
 *    the `.http` clients). Richer formulas (methods, ternary, `match`, `secret(...)`, `previous(...)`)
 *    are left as-is (a foreign client sends them literally) — {@link hasSeeboLogic} flags those.
 *  - **snapshot** — resolve formulas to concrete values; that needs the Seebo engine and happens in
 *    the main process, not here.
 *  - **verbatim** — leave the Seebo formulas untouched.
 *
 * Secrets are never emitted as values: a `${ secret('NAME') }` is turned into a `{{NAME}}` placeholder
 * (flagged when the target format supports it), so an exported file never carries a credential.
 */

const ENV_CALL = /\$\{\s*env\(\s*'([^']+)'\s*\)\s*\}/g;
const SECRET_CALL = /\$\{\s*secret\(\s*'([^']+)'\s*\)\s*\}/g;
const BARE = /\$\{\s*([A-Za-z_]\w*)\s*\}/g;
const ANY_FORMULA = /\$\{[^}]*\}/;

/** `env('X')` / `secret('X')` / bare `${ X }` → `{{X}}` (the "variabilize" strategy). */
export function variabilizeSeebo(s: string): string {
  return s.replace(SECRET_CALL, '{{$1}}').replace(ENV_CALL, '{{$1}}').replace(BARE, '{{$1}}');
}

/** True when any Seebo formula is present. */
export function hasSeebo(s: string): boolean {
  return ANY_FORMULA.test(s);
}

/**
 * True when the string still contains a Seebo formula that `variabilize` could **not** reduce to a
 * plain `{{ }}` variable — i.e. logic/methods/calls a foreign tool won't understand. Used to warn in
 * the export fidelity report.
 */
export function hasSeeboLogic(s: string): boolean {
  return hasSeebo(variabilizeSeebo(s));
}
