import type { ImportedCollection, ImportedRequest } from './collection';
import type { HttpAuth, HttpMethod, HttpRequestModel } from './ops';

/**
 * Import an OpenAPI 3.x description into a neutral {@link ImportedCollection} — one `api` request per
 * operation (open-standards plan §6.1). The spec must already be parsed (JSON or YAML → object); this
 * function is pure and tolerant, and never throws on a malformed spec (it returns what it can).
 *
 * Mapping:
 *  - `servers[0].url` (server variables substituted by their defaults) → a `BASE_URL` env var; every
 *    request URL is `${ env('BASE_URL') }` + path.
 *  - OpenAPI path templating `{param}` → Seebo `${ param }`.
 *  - required `query` parameters → `?name=${ name }`; `header` parameters → `Name: ${ name }`.
 *  - a JSON `requestBody` example (or the first named example) → the request body (`bodyType: json`).
 *  - the first global `security` requirement whose scheme is http-bearer / http-basic / apiKey →
 *    structured auth, with secret values referenced as `${ secret('…') }`.
 *  - `tags[0]` → the folder the request is grouped under; `operationId` (or `METHOD path`) → its name.
 */

const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Resolve `servers[0].url`, substituting `{var}` with each variable's `default`. */
function baseUrlOf(spec: Obj): string | null {
  const servers = spec.servers;
  const first = Array.isArray(servers) && isObj(servers[0]) ? servers[0] : undefined;
  let url = first ? str(first.url) : undefined;
  if (!url) return null;
  const vars = isObj(first!.variables) ? first!.variables : {};
  url = url.replace(/\{([^}]+)\}/g, (whole, name: string) => {
    const v = isObj(vars[name]) ? vars[name] : undefined;
    return str((v as Obj | undefined)?.default) ?? whole;
  });
  return url;
}

/** Turn an OpenAPI path (`/pets/{id}`) into a Seebo URL fragment (`/pets/${ id }`). */
function pathToUrl(path: string): string {
  return path.replace(/\{([^}]+)\}/g, (_all, name: string) => `\${ ${name.trim()} }`);
}

function collectParams(op: Obj, pathItem: Obj): Obj[] {
  const out: Obj[] = [];
  for (const list of [pathItem.parameters, op.parameters]) {
    if (Array.isArray(list)) for (const p of list) if (isObj(p)) out.push(p);
  }
  return out;
}

/** A JSON example from a `requestBody`/`content` object, if any. */
function jsonBody(op: Obj): string | undefined {
  const rb = isObj(op.requestBody) ? op.requestBody : undefined;
  const content = rb && isObj(rb.content) ? rb.content : undefined;
  const json = content && isObj(content['application/json']) ? content['application/json'] : undefined;
  if (!json) return undefined;
  if (json.example !== undefined) return JSON.stringify(json.example, null, 2);
  if (isObj(json.examples)) {
    const first = Object.values(json.examples).find(isObj);
    if (first && first.value !== undefined) return JSON.stringify(first.value, null, 2);
  }
  const schema = isObj(json.schema) ? json.schema : undefined;
  if (schema && schema.example !== undefined) return JSON.stringify(schema.example, null, 2);
  return undefined;
}

/** Map the first applicable global security requirement to structured auth. */
function authOf(spec: Obj): HttpAuth | undefined {
  const security = spec.security;
  const req = Array.isArray(security) && isObj(security[0]) ? security[0] : undefined;
  if (!req) return undefined;
  const schemeName = Object.keys(req)[0];
  const comps = isObj(spec.components) ? spec.components : undefined;
  const schemes = comps && isObj(comps.securitySchemes) ? comps.securitySchemes : undefined;
  const scheme = schemes && schemeName && isObj(schemes[schemeName]) ? schemes[schemeName] : undefined;
  if (!scheme) return undefined;
  const type = str(scheme.type);
  const httpScheme = str(scheme.scheme)?.toLowerCase();
  if (type === 'http' && httpScheme === 'bearer') {
    return { kind: 'bearer', token: "${ secret('BEARER_TOKEN') }" };
  }
  if (type === 'http' && httpScheme === 'basic') {
    return { kind: 'basic', username: "${ env('USERNAME') }", password: "${ secret('PASSWORD') }" };
  }
  if (type === 'apiKey') {
    const placement = str(scheme.in) === 'query' ? 'query' : 'header';
    return {
      kind: 'apikey',
      key: str(scheme.name) ?? 'X-API-Key',
      value: "${ secret('API_KEY') }",
      placement,
    };
  }
  return undefined;
}

export function fromOpenApi(spec: unknown): ImportedCollection {
  const empty: ImportedCollection = { name: 'Imported API', requests: [], environments: [] };
  if (!isObj(spec)) return empty;

  const info = isObj(spec.info) ? spec.info : {};
  const title = str(info.title) ?? 'Imported API';
  const base = baseUrlOf(spec);
  const auth = authOf(spec);
  const requests: ImportedRequest[] = [];

  const paths = isObj(spec.paths) ? spec.paths : {};
  for (const [path, pathItemRaw] of Object.entries(paths)) {
    if (!isObj(pathItemRaw)) continue;
    const pathItem = pathItemRaw;
    for (const method of HTTP_METHODS) {
      const opRaw = pathItem[method.toLowerCase()];
      if (!isObj(opRaw)) continue;
      const op = opRaw;

      const params = collectParams(op, pathItem);
      const headers: Record<string, string> = {};
      const queryParts: string[] = [];
      for (const p of params) {
        const name = str(p.name);
        if (!name) continue;
        if (p.in === 'header') headers[name] = `\${ ${name} }`;
        else if (p.in === 'query' && p.required === true) queryParts.push(`${name}=\${ ${name} }`);
      }

      const query = queryParts.length ? `?${queryParts.join('&')}` : '';
      const url = `${base ? "${ env('BASE_URL') }" : ''}${pathToUrl(path)}${query}`;

      const request: HttpRequestModel = { method, url };
      if (Object.keys(headers).length) request.headers = headers;
      const body = jsonBody(op);
      if (body != null) {
        request.body = body;
        request.bodyType = 'json';
      }
      if (auth) request.auth = auth;
      const description = str(op.summary) ?? str(op.description);
      if (description) request.info = description;

      const name = str(op.operationId) ?? `${method} ${path}`;
      const tag = Array.isArray(op.tags) ? str(op.tags[0]) : undefined;
      requests.push({ name, folderPath: tag ? [tag] : [], request, description });
    }
  }

  const environments = base ? [{ name: 'Default', vars: { BASE_URL: base } }] : [];
  return { name: title, requests, environments };
}
