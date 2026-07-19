import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SettingsService } from '../workspace/SettingsService';
import { IdentityCipher } from '../auth/testing';
import { SecretService } from '../secret/SecretService';
import { HttpService } from './HttpService';

function settings(
  blockedDomains: string[] = [],
  enforcedHeaders: Record<string, string> = {},
): SettingsService {
  return {
    getSettings: () => Promise.resolve({ blockedDomains, enforcedHeaders }),
  } as unknown as SettingsService;
}

const fakeFetch = (
  impl: (url: string, init: { headers: Headers; method: string }) => Response,
): typeof fetch =>
  ((input: unknown, init: unknown) =>
    Promise.resolve(impl(String(input), init as { headers: Headers; method: string }))) as typeof fetch;

let dir: string;
let secrets: SecretService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'swaft-http-'));
  secrets = new SecretService(join(dir, 'secrets.json'), new IdentityCipher());
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('HttpService', () => {
  it('blocks a block-listed domain (incl. subdomains) with a coded error', async () => {
    const http = new HttpService({
      fetchFn: fakeFetch(() => new Response('ok')),
      secrets,
      settings: settings(['evil.com']),
    });
    await expect(http.send({ method: 'GET', url: 'https://evil.com/x' })).rejects.toMatchObject({
      code: 'DOMAIN_NOT_ALLOWED',
    });
    await expect(http.send({ method: 'GET', url: 'https://api.evil.com/x' })).rejects.toMatchObject({
      code: 'DOMAIN_NOT_ALLOWED',
    });
  });

  it('allows any non-blocked host (empty block-list = allow all) and returns the response + query', async () => {
    let calledUrl = '';
    const http = new HttpService({
      fetchFn: fakeFetch((url) => {
        calledUrl = url;
        return new Response('hello', { status: 200, statusText: 'OK' });
      }),
      secrets,
      settings: settings(),
    });
    const res = await http.send({
      method: 'GET',
      url: 'https://api.example.com/x',
      query: { a: '1' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe('hello');
    expect(calledUrl).toContain('a=1');
  });

  it('re-validates redirects and blocks a redirect into a blocked host', async () => {
    const http = new HttpService({
      fetchFn: fakeFetch((url) =>
        url.includes('example.com')
          ? new Response('', { status: 302, headers: { location: 'https://evil.com/y' } })
          : new Response('reached', { status: 200 }),
      ),
      secrets,
      settings: settings(['evil.com']),
    });
    await expect(http.send({ method: 'GET', url: 'https://example.com/x' })).rejects.toMatchObject({
      code: 'DOMAIN_NOT_ALLOWED',
    });
  });

  it('force-applies enforced headers over the request own headers', async () => {
    let seen: Headers | null = null;
    const http = new HttpService({
      fetchFn: fakeFetch((_url, init) => {
        seen = init.headers;
        return new Response('ok', { status: 200 });
      }),
      secrets,
      settings: settings([], { 'X-Tenant': 'acme', 'User-Agent': 'swaft' }),
    });
    await http.send({
      method: 'GET',
      url: 'https://example.com/x',
      headers: { 'X-Tenant': 'other', Accept: 'application/json' },
    });
    expect(seen!.get('x-tenant')).toBe('acme');
    expect(seen!.get('user-agent')).toBe('swaft');
    expect(seen!.get('accept')).toBe('application/json');
  });

  it('applies bearer auth from a keychain secret (the value never leaves the main process)', async () => {
    secrets.set('token', 'SUPERSECRET');
    let auth: string | null = null;
    const http = new HttpService({
      fetchFn: fakeFetch((_url, init) => {
        auth = init.headers.get('authorization');
        return new Response('ok', { status: 200 });
      }),
      secrets,
      settings: settings(),
    });
    await http.send({
      method: 'GET',
      url: 'https://example.com/x',
      auth: { kind: 'bearer', secretRef: 'token' },
    });
    expect(auth).toBe('Bearer SUPERSECRET');
    // Only the reference is enumerable; the value is not part of the listing.
    expect(secrets.list()).toEqual(['token']);
  });
});
