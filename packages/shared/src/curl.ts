import type { HttpAuth, HttpMethod, HttpRequestModel } from './ops';

/**
 * Codec between an {@link HttpRequestModel} and a `curl` command line (open-standards plan §6.1).
 *
 * `fromCurl` is the high-value direction — paste a `curl` command, get a structured request. It is
 * tolerant: it recognizes the common flags and treats anything else as a no-op, never throwing.
 * `toCurl` renders the request as a single, copy-pasteable command.
 *
 * Seebo `${ … }` formulas are preserved **verbatim** (plan A3). `toCurl` is a plain serializer; when a
 * request carries formulas the caller may first run the export conversion dialog (variabilize /
 * snapshot) — this codec does not translate them.
 */

const KNOWN_METHODS: readonly HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

/** Flags that consume the following token as their value. */
const ARG_FLAGS = new Set([
  '-X',
  '--request',
  '-H',
  '--header',
  '-d',
  '--data',
  '--data-raw',
  '--data-ascii',
  '--data-binary',
  '--data-urlencode',
  '-F',
  '--form',
  '-u',
  '--user',
  '-b',
  '--cookie',
  '-A',
  '--user-agent',
  '-e',
  '--referer',
  '--url',
  '--json',
]);

/** Shell-tokenize a command, honoring single/double quotes and backslash-newline continuations. */
export function tokenizeShell(cmd: string): string[] {
  const s = cmd.replace(/\\\r?\n/g, ' ');
  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    let tok = '';
    while (i < s.length && !/\s/.test(s[i])) {
      const c = s[i];
      if (c === "'") {
        i++;
        while (i < s.length && s[i] !== "'") tok += s[i++];
        i++;
      } else if (c === '"') {
        i++;
        while (i < s.length && s[i] !== '"') {
          if (s[i] === '\\' && i + 1 < s.length && /["\\$`]/.test(s[i + 1])) {
            tok += s[i + 1];
            i += 2;
          } else {
            tok += s[i++];
          }
        }
        i++;
      } else if (c === '\\' && i + 1 < s.length) {
        tok += s[i + 1];
        i += 2;
      } else {
        tok += c;
        i++;
      }
    }
    tokens.push(tok);
  }
  return tokens;
}

function bodyTypeFor(headers: Record<string, string>, body: string): HttpRequestModel['bodyType'] {
  const ct = (
    Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
  ).toLowerCase();
  if (ct.includes('json') || ct.includes('+json')) return 'json';
  if (ct.includes('x-www-form-urlencoded')) return 'form';
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('text/')) return 'text';
  const t = body.trim();
  if (t.startsWith('{') || t.startsWith('[')) return 'json';
  return body ? 'form' : undefined;
}

/** Parse a `curl` command into a request. Tolerant: unrecognized flags are ignored. */
export function fromCurl(command: string): HttpRequestModel {
  const tokens = tokenizeShell(command.trim());
  if (tokens[0]?.toLowerCase() === 'curl') tokens.shift();

  let method: HttpMethod | undefined;
  let url = '';
  let forceGet = false;
  const headers: Record<string, string> = {};
  const dataParts: string[] = [];
  let auth: HttpAuth | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const takesArg = ARG_FLAGS.has(tok);
    const arg = takesArg ? (tokens[++i] ?? '') : '';

    switch (tok) {
      case '-X':
      case '--request': {
        const m = arg.toUpperCase();
        if ((KNOWN_METHODS as readonly string[]).includes(m)) method = m as HttpMethod;
        break;
      }
      case '-H':
      case '--header': {
        const colon = arg.indexOf(':');
        if (colon > 0) headers[arg.slice(0, colon).trim()] = arg.slice(colon + 1).trim();
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-ascii':
      case '--data-binary':
      case '--data-urlencode':
      case '-F':
      case '--form':
        dataParts.push(arg);
        break;
      case '--json':
        dataParts.push(arg);
        if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
          headers['Content-Type'] = 'application/json';
        }
        break;
      case '-u':
      case '--user': {
        const sep = arg.indexOf(':');
        auth = {
          kind: 'basic',
          username: sep >= 0 ? arg.slice(0, sep) : arg,
          password: sep >= 0 ? arg.slice(sep + 1) : '',
        };
        break;
      }
      case '-b':
      case '--cookie':
        headers['Cookie'] = arg;
        break;
      case '-A':
      case '--user-agent':
        headers['User-Agent'] = arg;
        break;
      case '-e':
      case '--referer':
        headers['Referer'] = arg;
        break;
      case '--url':
        url = arg;
        break;
      case '-G':
      case '--get':
        forceGet = true;
        break;
      default:
        if (!tok.startsWith('-') && url === '') url = tok;
        break;
    }
  }

  const body = dataParts.join('&');
  const request: HttpRequestModel = {
    method: forceGet ? 'GET' : (method ?? (body ? 'POST' : 'GET')),
    url,
  };
  if (Object.keys(headers).length > 0) request.headers = headers;
  if (body !== '') {
    request.body = body;
    const bt = bodyTypeFor(headers, body);
    if (bt != null) request.bodyType = bt;
  }
  if (auth != null) request.auth = auth;
  return request;
}

/** Wrap a value in single quotes, escaping embedded single quotes for POSIX shells. */
function sq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const BODY_TYPE_CONTENT_TYPE: Record<string, string> = {
  json: 'application/json',
  form: 'application/x-www-form-urlencoded',
  text: 'text/plain',
  xml: 'application/xml',
};

/** Render a request as a single-line `curl` command. Seebo formulas are emitted verbatim. */
export function toCurl(req: HttpRequestModel): string {
  const parts: string[] = ['curl'];
  if (req.method && req.method !== 'GET') parts.push('-X', req.method);

  const headers: Record<string, string> = { ...(req.headers ?? {}) };
  const auth = req.auth;
  const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');

  // Structured auth → curl form.
  if (auth) {
    if (auth.kind === 'bearer' && auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
    else if (auth.kind === 'apikey' && auth.key) {
      if (auth.placement === 'query') {
        const join = (req.url ?? '').includes('?') ? '&' : '?';
        req = { ...req, url: `${req.url ?? ''}${join}${auth.key}=${auth.value ?? ''}` };
      } else {
        headers[auth.key] = auth.value ?? '';
      }
    }
  }

  const body = req.body ?? '';
  if (body !== '' && req.bodyType && req.bodyType !== 'none' && !hasContentType) {
    headers['Content-Type'] = BODY_TYPE_CONTENT_TYPE[req.bodyType] ?? 'text/plain';
  }

  if (auth && auth.kind === 'basic') parts.push('-u', sq(`${auth.username ?? ''}:${auth.password ?? ''}`));

  for (const [name, value] of Object.entries(headers)) parts.push('-H', sq(`${name}: ${value}`));
  if (body !== '') parts.push('--data-raw', sq(body));
  parts.push(sq(req.url ?? ''));
  return parts.join(' ');
}
