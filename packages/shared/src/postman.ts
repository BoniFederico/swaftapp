import type { ImportedCollection, ImportedRequest } from './collection';
import type { HttpAuth, HttpMethod, HttpRequestModel } from './ops';

/**
 * Import/export a Postman Collection v2.1 to/from the neutral {@link ImportedCollection}
 * (open-standards plan §6). Only the variable-substitution boundary is translated:
 *
 *  - **import:** Postman `{{var}}` → Seebo `${ var }` (resolves via the env-fallback sugar).
 *  - **export:** Seebo `${ env('X') }` and the bare `${ X }` → Postman `{{X}}` (the "variabilize"
 *    strategy). Richer Seebo formulas are left verbatim (a Postman client sends them literally) — the
 *    export UI offers snapshot/other strategies before calling this codec.
 *
 * Pre/post `actions` and non-request template types are out of scope here (they have no Postman
 * request equivalent); the collection-level orchestration decides what to skip and reports it.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const POSTMAN_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

// --- variable-boundary translation -----------------------------------------

/** Postman `{{var}}` → Seebo `${ var }`. */
export function postmanToSeebo(s: string): string {
  return s.replace(/\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g, '${ $1 }');
}

/** Seebo `${ env('X') }` / bare `${ X }` → Postman `{{X}}` (leaves richer formulas untouched). */
export function seeboToPostman(s: string): string {
  return s
    .replace(/\$\{\s*env\(\s*'([^']+)'\s*\)\s*\}/g, '{{$1}}')
    .replace(/\$\{\s*([A-Za-z_]\w*)\s*\}/g, '{{$1}}');
}

// --- import ----------------------------------------------------------------

function importAuth(auth: unknown): HttpAuth | undefined {
  if (!isObj(auth)) return undefined;
  const type = str(auth.type);
  const params = Array.isArray(auth[type as string])
    ? (auth[type as string] as unknown[])
    : undefined;
  const pick = (key: string): string | undefined => {
    const entry = params?.find((p) => isObj(p) && p.key === key);
    return entry && isObj(entry) ? str(entry.value) : undefined;
  };
  const t = (v: string | undefined) => (v == null ? undefined : postmanToSeebo(v));
  if (type === 'bearer') return { kind: 'bearer', token: t(pick('token')) ?? '' };
  if (type === 'basic')
    return { kind: 'basic', username: t(pick('username')) ?? '', password: t(pick('password')) ?? '' };
  if (type === 'apikey') {
    const placement = pick('in') === 'query' ? 'query' : 'header';
    return { kind: 'apikey', key: t(pick('key')) ?? '', value: t(pick('value')) ?? '', placement };
  }
  return undefined;
}

function importUrl(url: unknown): string {
  if (typeof url === 'string') return postmanToSeebo(url);
  if (isObj(url) && typeof url.raw === 'string') return postmanToSeebo(url.raw);
  return '';
}

function importBody(body: unknown, headers: Record<string, string>): Pick<HttpRequestModel, 'body' | 'bodyType'> {
  if (!isObj(body)) return {};
  const mode = str(body.mode);
  if (mode === 'raw' && typeof body.raw === 'string') {
    const lang = isObj(body.options) && isObj(body.options.raw) ? str(body.options.raw.language) : undefined;
    const ct = (Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '').toLowerCase();
    let bodyType: HttpRequestModel['bodyType'] = 'text';
    if (lang === 'json' || ct.includes('json')) bodyType = 'json';
    else if (lang === 'xml' || ct.includes('xml')) bodyType = 'xml';
    return { body: postmanToSeebo(body.raw), bodyType };
  }
  if ((mode === 'urlencoded' || mode === 'formdata') && Array.isArray(body[mode])) {
    const pairs = (body[mode] as unknown[])
      .filter((p): p is Obj => isObj(p) && p.disabled !== true)
      .map((p) => `${str(p.key) ?? ''}=${postmanToSeebo(str(p.value) ?? '')}`);
    return { body: pairs.join('&'), bodyType: 'form' };
  }
  return {};
}

function walkItems(items: unknown, path: string[], out: ImportedRequest[]): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!isObj(item)) continue;
    const name = str(item.name) ?? 'request';
    if (Array.isArray(item.item)) {
      walkItems(item.item, [...path, name], out); // a folder
      continue;
    }
    const req = isObj(item.request) ? item.request : undefined;
    if (!req) continue;
    const method = (str(req.method)?.toUpperCase() ?? 'GET') as HttpMethod;
    const headers: Record<string, string> = {};
    if (Array.isArray(req.header)) {
      for (const h of req.header) {
        if (isObj(h) && h.disabled !== true && str(h.key)) {
          headers[str(h.key)!] = postmanToSeebo(str(h.value) ?? '');
        }
      }
    }
    const request: HttpRequestModel = {
      method: (HTTP_METHODS as readonly string[]).includes(method) ? method : 'GET',
      url: importUrl(req.url),
    };
    if (Object.keys(headers).length) request.headers = headers;
    const { body, bodyType } = importBody(req.body, headers);
    if (body != null) request.body = body;
    if (bodyType != null) request.bodyType = bodyType;
    const auth = importAuth(req.auth);
    if (auth) request.auth = auth;
    const description = str(req.description);
    if (description) request.info = description;
    out.push({ name, folderPath: path, request, description });
  }
}

export function fromPostman(collection: unknown): ImportedCollection {
  const empty: ImportedCollection = { name: 'Imported collection', requests: [], environments: [] };
  if (!isObj(collection)) return empty;
  const info = isObj(collection.info) ? collection.info : {};
  const name = str(info.name) ?? 'Imported collection';
  const requests: ImportedRequest[] = [];
  walkItems(collection.item, [], requests);

  const vars: Record<string, string> = {};
  if (Array.isArray(collection.variable)) {
    for (const v of collection.variable) {
      if (isObj(v) && str(v.key)) vars[str(v.key)!] = postmanToSeebo(str(v.value) ?? '');
    }
  }
  const environments = Object.keys(vars).length ? [{ name, vars }] : [];
  return { name, requests, environments };
}

// --- export ----------------------------------------------------------------

interface PostmanFolder {
  name: string;
  item: unknown[];
}

function exportAuth(auth: HttpAuth): Obj | undefined {
  const v = (s: string | undefined) => seeboToPostman(s ?? '');
  if (auth.kind === 'bearer') return { type: 'bearer', bearer: [{ key: 'token', value: v(auth.token) }] };
  if (auth.kind === 'basic')
    return {
      type: 'basic',
      basic: [
        { key: 'username', value: v(auth.username) },
        { key: 'password', value: v(auth.password) },
      ],
    };
  if (auth.kind === 'apikey')
    return {
      type: 'apikey',
      apikey: [
        { key: 'key', value: v(auth.key) },
        { key: 'value', value: v(auth.value) },
        { key: 'in', value: auth.placement ?? 'header' },
      ],
    };
  return undefined;
}

function exportBody(req: HttpRequestModel): Obj | undefined {
  if (req.body == null || req.body === '') return undefined;
  const raw = seeboToPostman(req.body);
  if (req.bodyType === 'form') {
    const urlencoded = raw.split('&').map((pair) => {
      const eq = pair.indexOf('=');
      return eq >= 0 ? { key: pair.slice(0, eq), value: pair.slice(eq + 1) } : { key: pair, value: '' };
    });
    return { mode: 'urlencoded', urlencoded };
  }
  const language = req.bodyType === 'json' ? 'json' : req.bodyType === 'xml' ? 'xml' : 'text';
  return { mode: 'raw', raw, options: { raw: { language } } };
}

function toPostmanItem(r: ImportedRequest): Obj {
  const req = r.request;
  const header = Object.entries(req.headers ?? {}).map(([key, value]) => ({
    key,
    value: seeboToPostman(value),
  }));
  const item: Obj = {
    name: r.name,
    request: {
      method: req.method,
      header,
      url: seeboToPostman(req.url),
      ...(req.info ? { description: req.info } : {}),
      ...(req.auth ? { auth: exportAuth(req.auth) } : {}),
      ...(exportBody(req) ? { body: exportBody(req) } : {}),
    },
  };
  return item;
}

/** Export a neutral collection to a Postman Collection v2.1 document (a plain object). */
export function toPostman(collection: { name: string; requests: ImportedRequest[] }): Obj {
  const root: PostmanFolder = { name: collection.name, item: [] };
  const folderAt = (path: string[]): PostmanFolder => {
    let node = root;
    for (const seg of path) {
      let child = node.item.find(
        (i): i is PostmanFolder => isObj(i) && i.name === seg && Array.isArray(i.item),
      );
      if (!child) {
        child = { name: seg, item: [] };
        node.item.push(child);
      }
      node = child;
    }
    return node;
  };
  for (const r of collection.requests) folderAt(r.folderPath).item.push(toPostmanItem(r));
  return {
    info: { name: collection.name, schema: POSTMAN_SCHEMA },
    item: root.item,
  };
}
