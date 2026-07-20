import { CAPABILITY_TYPES, DEVELOPER_MODULE_ALLOWLIST, type ScriptProfile } from './contract';

/**
 * Pure guards for user-authored JavaScript. Everything here is side-effect free and runs identically
 * in the main process (before dispatching a run) and inside the script host (before importing), so a
 * rejection is reported the same way whichever side notices first.
 *
 * The isolation boundary is the host *process* (analisi_codice_utente.md §3.3); these checks are the
 * layer above it, and their job is to keep an honest author from reaching ambient authority by
 * accident rather than to stop a determined attacker.
 */

/**
 * Blank out comments and string/template literals, preserving offsets, so a syntax scan cannot be
 * fooled by — or trip over — the word `import` inside a comment or a quoted string.
 */
export function stripCommentsAndLiterals(source: string): string {
  const out = source.split('');
  let i = 0;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const quote = source[i]!;
      let k = i + 1;
      while (k < source.length) {
        if (source[k] === '\\') k += 2;
        else if (source[k] === quote) break;
        else k++;
      }
      const stop = Math.min(k + 1, source.length);
      blank(i + 1, stop - 1);
      i = stop;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** `import` (static or dynamic) and CommonJS `require`, outside comments and literals. */
const IMPORT_SYNTAX = /(^|[^\w.$])import\s*(\(|['"]|[\w{*])/;
const REQUIRE_SYNTAX = /(^|[^\w.$])require\s*\(/;
/** The specifier of every import in a source: `from 'x'`, `import 'x'`, `import('x')`. */
const IMPORT_SPECIFIER = /(?:^|[^\w.$])import\s*(?:\(\s*)?['"]([^'"]+)['"]|\bfrom\s*['"]([^'"]+)['"]/g;

/**
 * Every module specifier the source imports. Read from the original text (not the blanked copy,
 * which has no literals left) after confirming the import itself is real code.
 */
export function importedSpecifiers(source: string): string[] {
  const code = stripCommentsAndLiterals(source);
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    // The blanked copy keeps offsets and turns comments into spaces, so a keyword that survives
    // there is real code; one that does not was inside a comment or a string.
    const at = match.index ?? 0;
    const blanked = code.slice(at, at + match[0].length);
    if (!blanked.includes('import') && !blanked.includes('from')) continue;
    const specifier = match[1] ?? match[2];
    if (specifier) found.push(specifier);
  }
  return found;
}

/**
 * Reject a source the sandbox profile must not run. Returns a human-readable reason, or null when
 * the source is acceptable.
 *
 * In `sandbox` no module may be pulled in at all: the host strips ambient globals, but a bare
 * `import 'node:fs'` would hand back everything it removed. The `developer` profile will replace
 * this blanket refusal with an allow-list once that phase lands, which is why the profile is a
 * parameter rather than an assumption.
 */
export function findForbiddenSyntax(source: string, profile: ScriptProfile): string | null {
  const code = stripCommentsAndLiterals(source);
  if (REQUIRE_SYNTAX.test(code)) {
    // Never available: user code is an ES module, and `require` would be a way back to everything.
    return 'require(...) is not available; user code runs as an ES module without Node built-ins';
  }
  if (!IMPORT_SYNTAX.test(code)) return null;
  if (profile === 'sandbox') {
    return 'importing modules is not allowed in sandbox execution mode';
  }
  // Developer profile: computation-only modules, by name.
  const allowed = new Set<string>(DEVELOPER_MODULE_ALLOWLIST);
  const specifiers = importedSpecifiers(source);
  if (specifiers.length === 0) {
    // An import the scanner cannot attribute to a specifier (computed, re-exported) is refused
    // rather than waved through: the allow-list only means something if it is exhaustive.
    return 'only literal imports of allowed modules are supported';
  }
  const refused = specifiers.filter((s) => !allowed.has(s));
  if (refused.length > 0) {
    return `these modules are not available to user code: ${refused.join(', ')} (allowed: ${[...allowed].join(', ')})`;
  }
  return null;
}

/**
 * Names a capability may not take: the input widgets and data capabilities Swaft registers itself.
 * Shadowing one would silently change what every existing template means.
 */
export function reservedCapabilityNames(builtins: readonly string[]): ReadonlySet<string> {
  return new Set(builtins);
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
/** Seebo calls a capability like a function, so its name must be a plain JS identifier. */
export function isValidCapabilityName(name: string): boolean {
  return IDENTIFIER.test(name);
}

/** Narrow a declared `export const type` to a Seebo base type, or null when it is not one. */
export function normalizeCapabilityType(value: unknown): string | null {
  return typeof value === 'string' && (CAPABILITY_TYPES as readonly string[]).includes(value)
    ? value
    : null;
}

/**
 * The engine flattens a capability call's descriptor onto the requirement and adds its own keys, so
 * `mieiDati({ id:'cfg', x:1 })` arrives as `{ id, x, capability, type }`. Strip what the engine owns
 * and keep what the author wrote (`id` included — authors routinely key on it).
 */
const ENGINE_OWNED_KEYS = new Set(['capability', 'type', 'label', 'description', 'constraints']);
export function capabilityArgs(requirement: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(requirement)) {
    if (!ENGINE_OWNED_KEYS.has(key)) args[key] = value;
  }
  // Some call shapes nest the author's fields under `args`; merge them so both forms behave alike.
  const nested = requirement.args;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    Object.assign(args, nested as Record<string, unknown>);
    delete args.args;
  }
  return args;
}

/**
 * Assert a value can cross the process boundary and enter the render state: JSON only, no cycles.
 * Mirrors Seebo's own sanitization (no `Date`, `Map`, class instances, functions, non-finite
 * numbers), so a capability cannot return something the engine would reject later with a much more
 * confusing message. Returns the offending path, or null when the value is fine.
 */
export function findNonJsonPath(value: unknown, path = '$', seen = new Set<unknown>()): string | null {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return null;
    case 'number':
      return Number.isFinite(value) ? null : path;
    case 'object':
      break;
    default:
      // undefined, function, symbol, bigint
      return path;
  }
  if (seen.has(value)) return path;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const bad = findNonJsonPath(value[i], `${path}[${i}]`, seen);
      if (bad) return bad;
    }
    seen.delete(value);
    return null;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return path;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const bad = findNonJsonPath(child, `${path}.${key}`, seen);
    if (bad) return bad;
  }
  seen.delete(value);
  return null;
}
