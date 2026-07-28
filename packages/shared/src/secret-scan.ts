/**
 * Heuristic scanner for **probable secret literals** in text destined for the open workspace folder
 * (open-standards plan §9). Once a workspace is committable, a plaintext token in a `.http`/JSON file
 * is a leak — this flags likely ones so the app can refuse/ warn and point the user at `secret('…')`.
 *
 * Pure and conservative: it ignores anything inside a Seebo `${ … }` or a `{{ … }}` placeholder (those
 * are references, not values), and only reports high-signal patterns. It never returns a full secret —
 * findings carry a redacted hint. False negatives are acceptable (it is a safety net, not a gate).
 */

export interface SecretFinding {
  kind: 'authorization-header' | 'known-token' | 'high-entropy';
  /** A redacted hint (first/last few chars) — never the full value. */
  hint: string;
}

/** Redact a value to `abcd…yz`, never revealing the middle. */
function redact(value: string): string {
  if (value.length <= 8) return `${value.slice(0, 2)}…`;
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

/** Replace `${ … }` and `{{ … }}` spans with spaces so references aren't mistaken for values. */
function stripPlaceholders(text: string): string {
  return text.replace(/\$\{[^}]*\}/g, ' ').replace(/\{\{[^}]*\}\}/g, ' ');
}

const KNOWN_TOKEN_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{12,}\b/g },
  { name: 'github-token', re: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: 'google-key', re: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
];

/** A long run that mixes lower, upper and digit — high-entropy enough to be a credential. */
const HIGH_ENTROPY = /\b(?=[A-Za-z0-9+/_-]*[a-z])(?=[A-Za-z0-9+/_-]*[A-Z])(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{40,}\b/g;

/** A literal (non-formula) Authorization credential. */
const AUTH_LITERAL = /authorization\s*:\s*(?:bearer|basic|token)\s+([^\s"'${}]+)/gi;

export function scanForSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();
  const add = (kind: SecretFinding['kind'], value: string): void => {
    const key = `${kind}:${value}`;
    if (value.length < 6 || seen.has(key)) return;
    seen.add(key);
    findings.push({ kind, hint: redact(value) });
  };

  // Authorization headers scan the raw text (the regex already excludes ${/{{ values).
  for (const m of text.matchAll(AUTH_LITERAL)) add('authorization-header', m[1]!);

  const stripped = stripPlaceholders(text);
  for (const { re } of KNOWN_TOKEN_PATTERNS) {
    for (const m of stripped.matchAll(re)) add('known-token', m[0]);
  }
  for (const m of stripped.matchAll(HIGH_ENTROPY)) add('high-entropy', m[0]);

  return findings;
}

/** True when the text contains at least one probable secret literal. */
export function hasSecretLiteral(text: string): boolean {
  return scanForSecrets(text).length > 0;
}
