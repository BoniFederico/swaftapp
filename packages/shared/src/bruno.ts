import type { ImportedCollection, ImportedEnvironment, ImportedRequest } from './collection';
import type { HttpAuth, HttpMethod, HttpRequestModel } from './ops';
import { bracesToSeebo } from './seebo-convert';

/**
 * Import/export a **Bruno** collection to/from the neutral {@link ImportedCollection}
 * (open-standards plan §6.1). Bruno is a git-native, file-per-request format: a directory with a
 * `bruno.json` and one `.bru` file (a small block DSL) per request. This codec models the collection
 * as a flat list of `{ path, content }` files the app writes to disk (or zips).
 *
 * `toBruno` serializes Seebo **verbatim** (conversion is applied upstream, plan §6.2). `fromBruno`
 * canonicalizes `{{var}}` → `${ var }` on the way in, like the Postman importer. Only the common
 * blocks are handled (meta, method+url, headers, bearer/basic/apikey auth, json/text/xml body).
 */

export interface BrunoFile {
  path: string;
  content: string;
}

const HTTP_METHODS = new Set<string>(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const BODY_KIND: Record<string, HttpRequestModel['bodyType']> = {
  json: 'json',
  text: 'text',
  xml: 'xml',
};

// --- .bru block DSL scanning -------------------------------------------------

interface Block {
  name: string;
  body: string;
}

/** Split a `.bru` file into top-level `name { … }` blocks (brace-depth aware, so JSON bodies survive). */
function scanBlocks(text: string): Block[] {
  const out: Block[] = [];
  const re = /([A-Za-z][\w:.-]*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let depth = 1;
    let j = re.lastIndex;
    const start = j;
    for (; j < text.length && depth > 0; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      if (depth === 0) break;
    }
    out.push({ name: m[1], body: text.slice(start, j) });
    re.lastIndex = j + 1;
  }
  return out;
}

/** Parse `key: value` lines of a dict-style block. */
function parseDict(body: string): Record<string, string> {
  const dict: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    const colon = t.indexOf(':');
    if (colon > 0) dict[t.slice(0, colon).trim()] = t.slice(colon + 1).trim();
  }
  return dict;
}

// --- import ------------------------------------------------------------------

function parseBru(content: string): { name: string; request: HttpRequestModel; swaftId?: string } | null {
  const blocks = scanBlocks(content);
  const meta = blocks.find((b) => b.name === 'meta');
  const methodBlock = blocks.find((b) => HTTP_METHODS.has(b.name));
  if (!methodBlock) return null;

  const method = methodBlock.name.toUpperCase() as HttpMethod;
  const methodFields = parseDict(methodBlock.body);
  const request: HttpRequestModel = { method, url: bracesToSeebo(methodFields.url ?? '') };

  const headers = blocks.find((b) => b.name === 'headers');
  if (headers) {
    const dict = parseDict(headers.body);
    const mapped: Record<string, string> = {};
    for (const [k, v] of Object.entries(dict)) mapped[k] = bracesToSeebo(v);
    if (Object.keys(mapped).length) request.headers = mapped;
  }

  const bodyKind = methodFields.body;
  if (bodyKind && bodyKind !== 'none') {
    const bodyBlock = blocks.find((b) => b.name === `body:${bodyKind}`);
    if (bodyBlock) {
      request.body = bracesToSeebo(bodyBlock.body.replace(/^\n/, '').replace(/\n\s*$/, ''));
      request.bodyType = BODY_KIND[bodyKind] ?? 'text';
    }
  }

  const authKind = methodFields.auth;
  if (authKind === 'bearer') {
    const d = parseDict(blocks.find((b) => b.name === 'auth:bearer')?.body ?? '');
    request.auth = { kind: 'bearer', token: bracesToSeebo(d.token ?? '') };
  } else if (authKind === 'basic') {
    const d = parseDict(blocks.find((b) => b.name === 'auth:basic')?.body ?? '');
    request.auth = {
      kind: 'basic',
      username: bracesToSeebo(d.username ?? ''),
      password: bracesToSeebo(d.password ?? ''),
    };
  } else if (authKind === 'apikey') {
    const d = parseDict(blocks.find((b) => b.name === 'auth:apikey')?.body ?? '');
    request.auth = {
      kind: 'apikey',
      key: bracesToSeebo(d.key ?? ''),
      value: bracesToSeebo(d.value ?? ''),
      placement: d.placement === 'queryparams' || d.placement === 'query' ? 'query' : 'header',
    };
  }

  const name = bruName(meta?.body) ?? method;
  const swaftId = meta ? parseDict(meta.body).swaftId : undefined;
  return { name, request, ...(swaftId ? { swaftId } : {}) };
}

function bruName(metaBody: string | undefined): string | undefined {
  if (metaBody == null) return undefined;
  return parseDict(metaBody).name;
}

export function fromBruno(files: BrunoFile[]): ImportedCollection {
  const brunoJson = files.find((f) => /(^|\/)bruno\.json$/.test(f.path));
  let name = 'Imported collection';
  if (brunoJson) {
    try {
      const parsed = JSON.parse(brunoJson.content) as { name?: unknown };
      if (typeof parsed.name === 'string') name = parsed.name;
    } catch {
      /* ignore */
    }
  }
  const requests: ImportedRequest[] = [];
  for (const f of files) {
    if (!f.path.endsWith('.bru')) continue;
    const parsed = parseBru(f.content);
    if (!parsed) continue;
    const segs = f.path.split('/').slice(0, -1).filter((s) => s !== '' && s !== '.');
    requests.push({
      name: parsed.name,
      folderPath: segs,
      request: parsed.request,
      ...(parsed.swaftId ? { swaftId: parsed.swaftId } : {}),
    });
  }
  return { name, requests, environments: [] };
}

// --- export ------------------------------------------------------------------

const DL = '\n';
function dict(entries: [string, string][]): string {
  return entries.map(([k, v]) => `  ${k}: ${v}`).join(DL);
}

function authBlock(auth: HttpAuth): string {
  if (auth.kind === 'bearer') return `${DL}auth:bearer {${DL}${dict([['token', auth.token ?? '']])}${DL}}${DL}`;
  if (auth.kind === 'basic')
    return `${DL}auth:basic {${DL}${dict([
      ['username', auth.username ?? ''],
      ['password', auth.password ?? ''],
    ])}${DL}}${DL}`;
  if (auth.kind === 'apikey')
    return `${DL}auth:apikey {${DL}${dict([
      ['key', auth.key ?? ''],
      ['value', auth.value ?? ''],
      ['placement', auth.placement === 'query' ? 'queryparams' : 'header'],
    ])}${DL}}${DL}`;
  return '';
}

function toBru(req: ImportedRequest, seq: number): string {
  const r = req.request;
  const method = r.method.toLowerCase();
  const bodyKind = r.body ? (r.bodyType && r.bodyType !== 'none' ? r.bodyType : 'text') : 'none';
  const authKind = r.auth && r.auth.kind !== 'none' && r.auth.kind !== 'inherit' ? r.auth.kind : 'none';

  let out = `meta {${DL}${dict([
    ['name', req.name],
    ['type', 'http'],
    ['seq', String(seq)],
    ...(req.swaftId ? ([['swaftId', req.swaftId]] as [string, string][]) : []),
  ])}${DL}}${DL}`;
  out += `${DL}${method} {${DL}${dict([
    ['url', r.url],
    ['body', bodyKind],
    ['auth', authKind],
  ])}${DL}}${DL}`;
  if (r.headers && Object.keys(r.headers).length) {
    out += `${DL}headers {${DL}${dict(Object.entries(r.headers))}${DL}}${DL}`;
  }
  if (r.auth && authKind !== 'none') out += authBlock(r.auth);
  if (r.body && bodyKind !== 'none') {
    out += `${DL}body:${bodyKind} {${DL}${r.body}${DL}}${DL}`;
  }
  return out;
}

/** Slugish, filesystem-safe base name for a `.bru` file. */
function safeFile(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'request';
}

/** Export a Swaft environment as a Bruno `environments/<name>.bru` file (a `vars { key: value }` block). */
function toBruEnvironment(env: ImportedEnvironment): BrunoFile {
  return {
    path: `environments/${safeFile(env.name)}.bru`,
    content: `vars {${DL}${dict(Object.entries(env.vars))}${DL}}${DL}`,
  };
}

/** Export a collection as Bruno files (`bruno.json` + one `.bru` per request + one per environment). */
export function toBruno(collection: {
  name: string;
  requests: ImportedRequest[];
  environments?: ImportedEnvironment[];
}): BrunoFile[] {
  const files: BrunoFile[] = [
    {
      path: 'bruno.json',
      content: `${JSON.stringify({ version: '1', name: collection.name, type: 'collection' }, null, 2)}\n`,
    },
  ];
  const seqByDir = new Map<string, number>();
  for (const req of collection.requests) {
    const dir = req.folderPath.join('/');
    const seq = (seqByDir.get(dir) ?? 0) + 1;
    seqByDir.set(dir, seq);
    const path = `${dir ? `${dir}/` : ''}${safeFile(req.name)}.bru`;
    files.push({ path, content: toBru(req, seq) });
  }
  for (const env of collection.environments ?? []) files.push(toBruEnvironment(env));
  return files;
}
