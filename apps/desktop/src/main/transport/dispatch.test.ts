import { describe, it, expect, afterEach } from 'vitest';
import { isError } from '@swaft/shared';
import { dispatch } from './dispatch';
import { setSessionGate } from './session';

afterEach(() => {
  // Restore the default (open) gate between tests.
  setSessionGate({ isSignedIn: () => true });
});

describe('transport dispatch', () => {
  it('handles the system.ping op', async () => {
    const r = await dispatch('system.ping', { echo: 'hi' });
    expect(isError(r)).toBe(false);
    if (!isError(r)) {
      const data = r.data as { pong: boolean; echo: string; ts: string };
      expect(data.pong).toBe(true);
      expect(data.echo).toBe('hi');
      expect(typeof data.ts).toBe('string');
    }
  });

  it('rejects an unknown op with a coded not_found error', async () => {
    const r = await dispatch('system.nope', {});
    expect(isError(r)).toBe(true);
    if (isError(r)) {
      expect(r.error.code).toBe('UNKNOWN_OP');
      expect(r.error.category).toBe('not_found');
    }
  });

  it('returns a validation error for a bad payload', async () => {
    const r = await dispatch('system.ping', { echo: 123 });
    expect(isError(r)).toBe(true);
    if (isError(r)) {
      expect(r.error.category).toBe('validation');
      expect(r.error.code).toBe('INVALID_PAYLOAD');
    }
  });

  it('rejects unknown keys (strict schema) before the handler runs', async () => {
    const r = await dispatch('system.ping', { echo: 'hi', injected: true });
    expect(isError(r)).toBe(true);
    if (isError(r)) expect(r.error.category).toBe('validation');
  });

  // The session guard is a host-agnostic seam: desktop leaves it open, but an injected closed gate
  // (as a hosted backend would use) must reject non-public ops before the handler runs.
  it('session-guards a non-public op when the injected gate is closed', async () => {
    setSessionGate({ isSignedIn: () => false });
    const r = await dispatch('prefs.get', {});
    expect(isError(r)).toBe(true);
    if (isError(r)) {
      expect(r.error.code).toBe('NO_SESSION');
      expect(r.error.category).toBe('auth');
    }
  });

  it('lets a non-public op past the guard when the gate is open', async () => {
    setSessionGate({ isSignedIn: () => true });
    // No services are wired here, so the handler fails internally — but crucially NOT with NO_SESSION,
    // which proves the guard let it through.
    const r = await dispatch('prefs.get', {});
    expect(isError(r)).toBe(true);
    if (isError(r)) expect(r.error.code).not.toBe('NO_SESSION');
  });
});
