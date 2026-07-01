import { describe, it, expect } from 'vitest';
import { AuthService, AuthError } from './AuthService';
import { Argon2Hasher } from './argon2-hasher';
import { InMemoryAccountStore } from './stores';
import { FakeHasher, IdentityCipher, makeTestAuthService } from './testing';

async function expectAuthError(p: Promise<unknown>, code: string, category?: string) {
  await expect(p).rejects.toBeInstanceOf(AuthError);
  await p.catch((e: AuthError) => {
    expect(e.code).toBe(code);
    if (category) expect(e.category).toBe(category);
  });
}

const SIGN_UP = { username: 'tech', displayName: 'Tech One', password: 'correct-horse' };

describe('AuthService', () => {
  it('starts at needs-setup and signs in after sign-up', async () => {
    const { service } = makeTestAuthService();
    expect(service.status()).toEqual({ state: 'needs-setup', profile: null });

    const res = await service.signUp(SIGN_UP);
    expect(res.state).toBe('signed-in');
    expect(res.profile).toEqual({ username: 'tech', displayName: 'Tech One' });
    expect(service.isSignedIn()).toBe(true);
  });

  it('produces a real Argon2id verifier, stored wrapped (never in clear) and never returned', async () => {
    const store = new InMemoryAccountStore();
    const service = new AuthService({ store, cipher: new IdentityCipher(), hasher: new Argon2Hasher() });

    const res = await service.signUp(SIGN_UP);

    const record = store.list()[0]!;
    // Wrapped by the cipher (not equal to the raw verifier), and the raw verifier is a PHC Argon2id.
    expect(record.protectedVerifier.startsWith('enc(')).toBe(true);
    const verifier = new IdentityCipher().reveal(record.protectedVerifier);
    expect(verifier.startsWith('$argon2id$')).toBe(true);
    // The plaintext password is nowhere in the record.
    expect(JSON.stringify(record)).not.toContain(SIGN_UP.password);
    // The verifier never travels in the response.
    expect(JSON.stringify(res)).not.toContain('argon2');
    expect(JSON.stringify(res)).not.toContain(verifier);
  });

  it('supports multiple accounts and rejects a duplicate username', async () => {
    const { service } = makeTestAuthService();
    await service.signUp(SIGN_UP);
    service.signOut();

    const second = await service.signUp({ username: 'tech2', password: 'another-pass' });
    expect(second.state).toBe('signed-in');
    expect(second.profile?.username).toBe('tech2');
    service.signOut();

    await expectAuthError(service.signUp(SIGN_UP), 'USERNAME_TAKEN', 'validation');
  });

  it('signs in with the correct password and fails generically on a wrong one', async () => {
    const { service } = makeTestAuthService();
    await service.signUp(SIGN_UP);
    service.signOut();

    await expectAuthError(
      service.signIn({ username: 'tech', password: 'wrong' }),
      'INVALID_CREDENTIALS',
      'auth',
    );
    // Wrong username is the SAME generic error (no enumeration).
    await expectAuthError(
      service.signIn({ username: 'nope', password: 'correct-horse' }),
      'INVALID_CREDENTIALS',
      'auth',
    );

    const ok = await service.signIn({ username: 'tech', password: 'correct-horse' });
    expect(ok.state).toBe('signed-in');
  });

  it('locks out after repeated failures and recovers after the window', async () => {
    let now = 1_000_000;
    const { service } = makeTestAuthService({
      maxAttempts: 3,
      baseLockoutMs: 5_000,
      now: () => now,
    });
    await service.signUp(SIGN_UP);
    service.signOut();

    for (let i = 0; i < 3; i++) {
      await expectAuthError(
        service.signIn({ username: 'tech', password: 'wrong' }),
        'INVALID_CREDENTIALS',
      );
    }
    // Now locked: even the correct password is refused while the window is open.
    await expectAuthError(
      service.signIn({ username: 'tech', password: 'correct-horse' }),
      'ACCOUNT_LOCKED',
      'auth',
    );

    // After the window elapses, the correct password works again.
    now += 5_001;
    const ok = await service.signIn({ username: 'tech', password: 'correct-horse' });
    expect(ok.state).toBe('signed-in');
  });

  it('lock → locked state; unlock with the password → signed-in', async () => {
    const { service } = makeTestAuthService();
    await service.signUp(SIGN_UP);

    expect(service.lock()).toEqual({
      state: 'locked',
      profile: { username: 'tech', displayName: 'Tech One' },
    });
    expect(service.isSignedIn()).toBe(false);

    await expectAuthError(service.unlock({ password: 'wrong' }), 'INVALID_CREDENTIALS');
    const ok = await service.unlock({ password: 'correct-horse' });
    expect(ok.state).toBe('signed-in');
    expect(service.isSignedIn()).toBe(true);
  });

  it('sign-out invalidates the session and returns to signed-out', async () => {
    const { service } = makeTestAuthService();
    await service.signUp(SIGN_UP);
    // Signed-out does not expose a profile (multiple accounts may exist; none is "current").
    expect(service.signOut()).toEqual({ state: 'signed-out', profile: null });
    expect(service.isSignedIn()).toBe(false);
  });

  it('whoami requires a session and never exposes the verifier', async () => {
    const { service } = makeTestAuthService();
    await service.signUp(SIGN_UP);

    const who = service.whoami();
    expect(who.profile).toEqual({ username: 'tech', displayName: 'Tech One' });
    expect(typeof who.sessionSince).toBe('string');
    expect(JSON.stringify(who)).not.toContain('fake$');

    service.signOut();
    expect(() => service.whoami()).toThrow(AuthError);
  });

  it('defaults the display name to the username when omitted', async () => {
    const { service } = makeTestAuthService({ hasher: new FakeHasher() });
    const res = await service.signUp({ username: 'solo', password: 'longenough' });
    expect(res.profile).toEqual({ username: 'solo', displayName: 'solo' });
  });
});
