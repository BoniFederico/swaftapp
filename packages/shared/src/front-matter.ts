/**
 * YAML **front matter** codec for document templates (open-standards plan §8 / C2). A document becomes
 * a single portable file: a `---`-delimited metadata block (the Jekyll/Hugo/Obsidian convention) on
 * top of the standard body (CommonMark, HTML, Mermaid, …). Seebo `${ … }` formulas stay inline in the
 * body and degrade gracefully in a non-Swaft viewer.
 *
 * Dependency-free by design (shared has no YAML runtime): it emits and parses a **constrained subset**
 * — flat scalar keys plus a single string-array `tags` — which is all the document metadata needs.
 * Parsing is tolerant: a file that doesn't open with a well-formed block is treated as pure body, so a
 * Markdown document that merely starts with a `---` thematic break is never mistaken for front matter.
 */

export interface DocumentMeta {
  swaftId?: string;
  name?: string;
  type?: string;
  subtype?: string;
  tags?: string[];
}

const NEEDS_QUOTE = /^[\s>|&*!%@`#-]|[:#[\]{},]|[\s]$|^$|^(true|false|null|~|yes|no)$/i;

function emitScalar(value: string): string {
  // Quote when the value would otherwise be misread as YAML syntax, a bool/null, or a bare number.
  if (NEEDS_QUOTE.test(value) || /^-?\d+(?:\.\d+)?$/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

function parseScalar(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

const KEYS: (keyof DocumentMeta)[] = ['swaftId', 'name', 'type', 'subtype'];

/** Serialize `{ meta, body }` to a front-matter document. Omits absent keys; empty meta → body only. */
export function toFrontMatter(meta: DocumentMeta, body: string): string {
  const lines: string[] = [];
  for (const key of KEYS) {
    const v = meta[key];
    if (typeof v === 'string' && v !== '') lines.push(`${key}: ${emitScalar(v)}`);
  }
  if (meta.tags && meta.tags.length > 0) {
    lines.push(`tags: [${meta.tags.map(emitScalar).join(', ')}]`);
  }
  if (lines.length === 0) return body;
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

function parseFlowList(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
  if (inner === '') return [];
  return inner.split(',').map((s) => parseScalar(s));
}

/** Parse a front-matter document into `{ meta, body }`. No/!well-formed block → `{}` + the whole text. */
export function parseFrontMatter(text: string): { meta: DocumentMeta; body: string } {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { meta: {}, body: text };
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return { meta: {}, body: text };

  const block = normalized.slice(4, end);
  const afterClose = normalized.indexOf('\n', end + 1);
  const body = afterClose === -1 ? '' : normalized.slice(afterClose + 1);

  const meta: DocumentMeta = {};
  const lines = block.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const colon = line.indexOf(':');
    if (colon <= 0 || /^\s/.test(line)) return { meta: {}, body: text }; // not key:value → not front matter
    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();

    if (key === 'tags') {
      if (rest.startsWith('[')) meta.tags = parseFlowList(rest);
      else {
        // block list: subsequent `  - item` lines
        const items: string[] = [];
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
          items.push(parseScalar(lines[++i].replace(/^\s*-\s+/, '')));
        }
        if (items.length) meta.tags = items;
      }
    } else if ((KEYS as string[]).includes(key)) {
      (meta as Record<string, string>)[key] = parseScalar(rest);
    }
    // unknown keys are ignored (kept out of the typed meta)
  }
  return { meta, body };
}
