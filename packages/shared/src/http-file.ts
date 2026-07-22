import type { HttpBodyType, HttpMethod, HttpRequestModel } from './ops';

/**
 * Codec between the HTTP-expressible core of an {@link HttpRequestModel} and a standard **`.http`
 * file** (the format used by the VS Code REST Client and the JetBrains HTTP Client).
 *
 * Scope (open-standards plan §5.1 / A2): this codec round-trips **method / url / headers / body /
 * bodyType / info** — the parts a `.http` file can represent. **Auth and pre/post actions are NOT
 * encoded here**; they are Swaft-only concerns stored alongside in `template.json`'s `api` block. The
 * `query` map is not represented (the URL is the single source of truth, matching the API view, so
 * callers fold query into the URL before encoding).
 *
 * **Seebo `${ … }` formulas are stored verbatim** (plan A3): the file stays valid `.http` *syntax*,
 * but a formula-bearing request is Swaft-flavored (another client would send `${ … }` literally).
 * Translation to `{{ }}`/values happens only on export to a foreign tool.
 *
 * Round-trip is a **stable fixed point** (idempotent after the first pass), not necessarily
 * byte-identical to the input model — e.g. a `bodyType` with no explicit `Content-Type` header gains
 * one, and `bodyType: 'none'` normalizes to absent. Parsing is tolerant and never throws.
 */

/** The subset of an {@link HttpRequestModel} a `.http` file represents. */
export type HttpFileModel = Pick<
  HttpRequestModel,
  'method' | 'url' | 'headers' | 'body' | 'bodyType' | 'info'
>;

const KNOWN_METHODS: readonly HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

const BODY_TYPE_CONTENT_TYPE: Record<Exclude<HttpBodyType, 'none'>, string> = {
  json: 'application/json',
  form: 'application/x-www-form-urlencoded',
  text: 'text/plain',
  xml: 'application/xml',
};

function headerKey(headers: Record<string, string>, lowerName: string): string | undefined {
  return Object.keys(headers).find((k) => k.toLowerCase() === lowerName);
}

function headerValue(headers: Record<string, string>, lowerName: string): string | undefined {
  const k = headerKey(headers, lowerName);
  return k == null ? undefined : headers[k];
}

/** Content-Type → the {@link HttpBodyType} we infer on read (absent = no typed body). */
function inferBodyType(headers: Record<string, string>, body: string): HttpBodyType | undefined {
  const ct = (headerValue(headers, 'content-type') ?? '').toLowerCase();
  if (ct.includes('application/json') || ct.includes('+json')) return 'json';
  if (ct.includes('x-www-form-urlencoded')) return 'form';
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('text/')) return 'text';
  if (body.trim() !== '') return 'text';
  return undefined;
}

/** Serialize the HTTP-expressible core of a request to a `.http` file (trailing newline included). */
export function toHttpFile(req: HttpFileModel): string {
  const out: string[] = [];

  if (req.info != null && req.info.trim() !== '') {
    for (const line of req.info.replace(/\r\n/g, '\n').split('\n')) {
      out.push(line === '' ? '#' : `# ${line}`);
    }
  }

  out.push(`${req.method} ${req.url ?? ''}`.trimEnd());

  const headers: Record<string, string> = { ...(req.headers ?? {}) };
  if (req.bodyType != null && req.bodyType !== 'none' && headerKey(headers, 'content-type') == null) {
    headers['Content-Type'] = BODY_TYPE_CONTENT_TYPE[req.bodyType];
  }
  for (const [name, value] of Object.entries(headers)) out.push(`${name}: ${value}`);

  const body = (req.body ?? '').replace(/\r\n/g, '\n');
  if (body !== '') {
    out.push('');
    out.push(body);
  }

  return `${out.join('\n')}\n`;
}

/** Strip a leading `#`/`//` comment marker and one space from an already-trimmed line. */
function commentBody(trimmed: string): string {
  if (trimmed.startsWith('//')) return trimmed.slice(2).replace(/^ /, '');
  return trimmed.replace(/^#+/, '').replace(/^ /, '');
}

/** Parse a `.http` file into the request core. Tolerant: never throws; reads the first request only. */
export function fromHttpFile(text: string): HttpFileModel {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const info: string[] = [];
  let i = 0;

  // Leading comments/blank lines → `info`. `###` is a request separator (ignored); `# @directive`
  // lines are directives (ignored), not prose.
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '') continue;
    if (t.startsWith('###')) {
      info.length = 0; // a separator resets any collected prose for the request that follows
      continue;
    }
    if (t.startsWith('#') || t.startsWith('//')) {
      const body = commentBody(t);
      if (!body.startsWith('@')) info.push(body);
      continue;
    }
    break; // the request line
  }

  const requestLine = (lines[i] ?? '').replace(/\s+HTTP\/[\d.]+\s*$/i, '').trim();
  i++;
  let method: HttpMethod = 'GET';
  let url = requestLine;
  const space = requestLine.indexOf(' ');
  if (space > 0) {
    const maybe = requestLine.slice(0, space).toUpperCase();
    if ((KNOWN_METHODS as readonly string[]).includes(maybe)) {
      method = maybe as HttpMethod;
      url = requestLine.slice(space + 1).trim();
    }
  } else if ((KNOWN_METHODS as readonly string[]).includes(requestLine.toUpperCase())) {
    method = requestLine.toUpperCase() as HttpMethod;
    url = '';
  }

  const headers: Record<string, string> = {};
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      break;
    }
    if (line.trim().startsWith('###')) break;
    const colon = line.indexOf(':');
    if (colon > 0) {
      const name = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      if (name !== '') headers[name] = value;
    }
  }

  const bodyLines: string[] = [];
  for (; i < lines.length; i++) {
    if (lines[i].trim().startsWith('###')) break;
    bodyLines.push(lines[i]);
  }
  const body = bodyLines.join('\n').replace(/\n+$/, '');

  const model: HttpFileModel = { method, url };
  if (Object.keys(headers).length > 0) model.headers = headers;
  if (body !== '') model.body = body;
  const bodyType = inferBodyType(headers, body);
  if (bodyType != null) model.bodyType = bodyType;
  if (info.length > 0) model.info = info.join('\n');
  return model;
}
