import { describe, expect, it } from 'vitest';
import { fromHttpFile, toHttpFile, type HttpFileModel } from './http-file';

/** Normalize for semantic comparison: drop `bodyType:'none'`, empty headers/info. */
function norm(m: HttpFileModel): HttpFileModel {
  const out: HttpFileModel = { method: m.method, url: m.url };
  if (m.headers && Object.keys(m.headers).length) out.headers = m.headers;
  if (m.body != null && m.body !== '') out.body = m.body;
  if (m.bodyType != null && m.bodyType !== 'none') out.bodyType = m.bodyType;
  if (m.info != null && m.info !== '') out.info = m.info;
  return out;
}

/** A model → file → model round-trip must reach a stable fixed point. */
function roundTrips(m: HttpFileModel): void {
  const once = fromHttpFile(toHttpFile(m));
  const twice = fromHttpFile(toHttpFile(once));
  expect(norm(twice)).toEqual(norm(once));
  // and serialization is idempotent from the parsed form
  expect(toHttpFile(twice)).toBe(toHttpFile(once));
}

describe('toHttpFile / fromHttpFile', () => {
  it('round-trips a bare GET', () => {
    const m: HttpFileModel = { method: 'GET', url: 'https://api.example.com/health' };
    expect(fromHttpFile(toHttpFile(m))).toEqual(m);
    expect(toHttpFile(m)).toBe('GET https://api.example.com/health\n');
  });

  it('round-trips headers', () => {
    const m: HttpFileModel = {
      method: 'GET',
      url: 'https://api.example.com/users',
      headers: { Accept: 'application/json', 'X-Trace': 'abc' },
    };
    expect(fromHttpFile(toHttpFile(m))).toEqual(m);
  });

  it('adds a Content-Type from bodyType and infers it back', () => {
    const m: HttpFileModel = {
      method: 'POST',
      url: 'https://api.example.com/orders',
      body: '{"id":1}',
      bodyType: 'json',
    };
    const file = toHttpFile(m);
    expect(file).toContain('Content-Type: application/json');
    const parsed = fromHttpFile(file);
    expect(parsed.bodyType).toBe('json');
    expect(parsed.body).toBe('{"id":1}');
    expect(parsed.headers).toEqual({ 'Content-Type': 'application/json' });
    roundTrips(m);
  });

  it('does not duplicate an explicit Content-Type', () => {
    const m: HttpFileModel = {
      method: 'POST',
      url: 'https://x/y',
      headers: { 'Content-Type': 'application/vnd.api+json' },
      body: '{}',
      bodyType: 'json',
    };
    const file = toHttpFile(m);
    expect(file.match(/Content-Type/gi)?.length).toBe(1);
    expect(fromHttpFile(file).bodyType).toBe('json'); // +json still infers json
  });

  it.each([
    ['form', 'application/x-www-form-urlencoded'],
    ['text', 'text/plain'],
    ['xml', 'application/xml'],
  ] as const)('maps bodyType %s to %s', (bodyType, ct) => {
    const file = toHttpFile({ method: 'POST', url: 'https://x', body: 'b', bodyType });
    expect(file).toContain(`Content-Type: ${ct}`);
    expect(fromHttpFile(file).bodyType).toBe(bodyType);
  });

  it('stores Seebo formulas verbatim (no {{ }} translation at rest)', () => {
    const m: HttpFileModel = {
      method: 'POST',
      url: "https://${ env('BASE_URL') }/orders/${ orderId }",
      headers: { Authorization: "Bearer ${ secret('API_TOKEN') }" },
      body: '{ "region": "${ region == \'eu\' ? \'EU\' : \'US\' }" }',
      bodyType: 'json',
    };
    const file = toHttpFile(m);
    expect(file).toContain("https://${ env('BASE_URL') }/orders/${ orderId }");
    expect(file).toContain("Bearer ${ secret('API_TOKEN') }");
    expect(file).not.toContain('{{');
    const parsed = fromHttpFile(file);
    expect(parsed.url).toBe(m.url);
    expect(parsed.headers?.Authorization).toBe(m.headers!.Authorization);
    expect(parsed.body).toBe(m.body);
    roundTrips(m);
  });

  it('round-trips multi-line info as leading comments', () => {
    const m: HttpFileModel = {
      method: 'GET',
      url: 'https://x',
      info: 'Fetch a thing\n\nSecond paragraph',
    };
    const file = toHttpFile(m);
    expect(file.startsWith('# Fetch a thing\n#\n# Second paragraph\n')).toBe(true);
    expect(fromHttpFile(file).info).toBe('Fetch a thing\n\nSecond paragraph');
  });

  it('parses a hand-written file with HTTP-version and // comments and blank body separator', () => {
    const parsed = fromHttpFile(
      ['// list the widgets', 'GET https://api/widgets HTTP/1.1', 'Accept: application/json', '', ''].join(
        '\n',
      ),
    );
    expect(parsed).toEqual({
      method: 'GET',
      url: 'https://api/widgets',
      headers: { Accept: 'application/json' },
      info: 'list the widgets',
    });
  });

  it('ignores # @directives (e.g. @name) rather than treating them as prose', () => {
    const parsed = fromHttpFile(['# @name getWidget', '# a real note', 'GET https://api/w'].join('\n'));
    expect(parsed.info).toBe('a real note');
  });

  it('parses a lowercase method and an unknown leading token as GET', () => {
    expect(fromHttpFile('post https://x\n').method).toBe('POST');
    // no recognizable method → whole line is the URL, method defaults to GET
    expect(fromHttpFile('https://x/only-a-url\n')).toEqual({ method: 'GET', url: 'https://x/only-a-url' });
  });

  it('reads only the first request when several are separated by ###', () => {
    const parsed = fromHttpFile(
      ['GET https://api/a', '', '### second', 'POST https://api/b', '', 'body'].join('\n'),
    );
    expect(parsed).toEqual({ method: 'GET', url: 'https://api/a' });
  });

  it('normalizes CRLF input', () => {
    const parsed = fromHttpFile('GET https://x\r\nAccept: */*\r\n');
    expect(parsed).toEqual({ method: 'GET', url: 'https://x', headers: { Accept: '*/*' } });
  });

  it('keeps a request with headers but no body', () => {
    const m: HttpFileModel = { method: 'DELETE', url: 'https://x/1', headers: { 'X-Confirm': 'yes' } };
    expect(fromHttpFile(toHttpFile(m))).toEqual(m);
  });
});
