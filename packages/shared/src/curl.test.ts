import { describe, expect, it } from 'vitest';
import { fromCurl, toCurl, tokenizeShell } from './curl';
import type { HttpRequestModel } from './ops';

describe('tokenizeShell', () => {
  it('honors single and double quotes and backslash-newline continuations', () => {
    expect(tokenizeShell(`curl -H 'A: b c' "https://x/y"`)).toEqual([
      'curl',
      '-H',
      'A: b c',
      'https://x/y',
    ]);
    expect(tokenizeShell("curl \\\n  -X POST \\\n  https://x")).toEqual([
      'curl',
      '-X',
      'POST',
      'https://x',
    ]);
  });
});

describe('fromCurl', () => {
  it('parses a bare GET', () => {
    expect(fromCurl('curl https://api.example.com/health')).toEqual({
      method: 'GET',
      url: 'https://api.example.com/health',
    });
  });

  it('parses method, headers and a JSON body (multi-line)', () => {
    const req = fromCurl(
      [
        'curl -X POST https://api/orders \\',
        "  -H 'Content-Type: application/json' \\",
        "  -H 'Accept: application/json' \\",
        `  -d '{"id":1,"n":"a b"}'`,
      ].join('\n'),
    );
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://api/orders');
    expect(req.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    expect(req.body).toBe('{"id":1,"n":"a b"}');
    expect(req.bodyType).toBe('json');
  });

  it('infers POST when data is present without -X', () => {
    expect(fromCurl("curl https://x -d 'a=1'").method).toBe('POST');
  });

  it('maps -u to basic auth', () => {
    expect(fromCurl('curl -u alice:secret https://x').auth).toEqual({
      kind: 'basic',
      username: 'alice',
      password: 'secret',
    });
  });

  it('maps --json to a JSON body + content-type', () => {
    const req = fromCurl(`curl --json '{"a":1}' https://x`);
    expect(req.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(req.bodyType).toBe('json');
    expect(req.body).toBe('{"a":1}');
  });

  it('ignores unknown/no-arg flags (-L -k --compressed)', () => {
    expect(fromCurl('curl -L -k --compressed https://x').url).toBe('https://x');
  });

  it('preserves Seebo formulas verbatim', () => {
    const req = fromCurl(`curl "https://\${ env('BASE_URL') }/x" -H "Authorization: Bearer \${ secret('T') }"`);
    expect(req.url).toBe("https://${ env('BASE_URL') }/x");
    expect(req.headers?.Authorization).toBe("Bearer ${ secret('T') }");
  });
});

describe('toCurl', () => {
  it('renders a bare GET', () => {
    expect(toCurl({ method: 'GET', url: 'https://x/y' })).toBe(`curl 'https://x/y'`);
  });

  it('renders method, headers and a body', () => {
    const cmd = toCurl({
      method: 'POST',
      url: 'https://api/orders',
      headers: { Accept: 'application/json' },
      body: '{"id":1}',
      bodyType: 'json',
    });
    expect(cmd).toContain('-X POST');
    expect(cmd).toContain(`-H 'Accept: application/json'`);
    expect(cmd).toContain(`-H 'Content-Type: application/json'`);
    expect(cmd).toContain(`--data-raw '{"id":1}'`);
    expect(cmd.endsWith(`'https://api/orders'`)).toBe(true);
  });

  it('renders bearer and basic auth', () => {
    expect(toCurl({ method: 'GET', url: 'https://x', auth: { kind: 'bearer', token: 'T' } })).toContain(
      `-H 'Authorization: Bearer T'`,
    );
    expect(
      toCurl({ method: 'GET', url: 'https://x', auth: { kind: 'basic', username: 'u', password: 'p' } }),
    ).toContain(`-u 'u:p'`);
  });

  it('appends an api-key query param to the url', () => {
    const cmd = toCurl({
      method: 'GET',
      url: 'https://x/y',
      auth: { kind: 'apikey', key: 'api_key', value: 'K', placement: 'query' },
    });
    expect(cmd).toContain(`'https://x/y?api_key=K'`);
  });

  it('escapes single quotes in values', () => {
    const cmd = toCurl({ method: 'POST', url: 'https://x', body: `it's` });
    expect(cmd).toContain(`--data-raw 'it'\\''s'`);
  });

  it('round-trips the common case through fromCurl', () => {
    const m: HttpRequestModel = {
      method: 'POST',
      url: 'https://api/orders',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{"id":1}',
    };
    const back = fromCurl(toCurl(m));
    expect(back.method).toBe('POST');
    expect(back.url).toBe('https://api/orders');
    expect(back.headers).toEqual(m.headers);
    expect(back.body).toBe('{"id":1}');
  });
});
