import { describe, it, expect } from 'vitest';
import { makeError, ok, isError, isKnownOp, OP_NAMES, validateOpRequest } from './index';

describe('error envelope', () => {
  it('builds a coded error envelope', () => {
    const e = makeError('DOMAIN_NOT_ALLOWED', 'policy', 'blocked', { host: 'x' });
    expect(e.error.code).toBe('DOMAIN_NOT_ALLOWED');
    expect(e.error.category).toBe('policy');
    expect(e.error.details).toEqual({ host: 'x' });
    expect(isError(e)).toBe(true);
  });

  it('builds an ok envelope', () => {
    const r = ok({ value: 42 });
    expect(r.ok).toBe(true);
    expect(isError(r)).toBe(false);
  });
});

describe('op registry', () => {
  it('recognizes known ops and rejects unknown ones', () => {
    expect(isKnownOp('system.ping')).toBe(true);
    expect(isKnownOp('system.nope')).toBe(false);
    expect(OP_NAMES).toContain('system.ping');
  });
});

describe('validateOpRequest', () => {
  it('accepts a valid payload and a missing (undefined) payload', () => {
    expect(validateOpRequest('system.ping', { echo: 'hi' })).toEqual({ ok: true, data: { echo: 'hi' } });
    expect(validateOpRequest('system.ping', undefined)).toEqual({ ok: true, data: {} });
  });

  it('rejects a wrong-typed field with flattened issues', () => {
    const r = validateOpRequest('system.ping', { echo: 123 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].path).toBe('echo');
  });

  it('rejects unknown keys (strict schema)', () => {
    const r = validateOpRequest('system.ping', { echo: 'hi', extra: true });
    expect(r.ok).toBe(false);
  });
});
