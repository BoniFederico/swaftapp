import { describe, it, expect, afterEach } from 'vitest';
import { isError } from '@swaft/shared';
import { dispatch } from './dispatch';
import { setSessionGate } from './session';
import { setAuthService } from '../auth/registry';
import { makeTestAuthService } from '../auth/testing';

afterEach(() => {
  // Restore the fail-closed default + clear the registered service between tests.
  setSessionGate({ isSignedIn: () => false });
  setAuthService(null);
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

  it('session-guards a non-public op when there is no session (fail-closed)', async () => {
    // Default gate is signed-out; the guard must reject before any handler/AuthService is touched.
    const r = await dispatch('session.whoami', {});
    expect(isError(r)).toBe(true);
    if (isError(r)) {
      expect(r.error.code).toBe('NO_SESSION');
      expect(r.error.category).toBe('auth');
    }
  });

  it('allows a non-public op once a session is active', async () => {
    const { service } = makeTestAuthService();
    await service.signUp({ username: 'tech', password: 'correct-horse' });
    setAuthService(service);
    setSessionGate({ isSignedIn: () => service.isSignedIn() });

    const r = await dispatch('session.whoami', {});
    expect(isError(r)).toBe(false);
    if (!isError(r)) {
      const data = r.data as { profile: { username: string } };
      expect(data.profile.username).toBe('tech');
    }
  });

  it('still session-guards even with a valid payload (guard runs before handler)', async () => {
    const r = await dispatch('auth.signOut', {});
    expect(isError(r)).toBe(true);
    if (isError(r)) expect(r.error.code).toBe('NO_SESSION');
  });
});
