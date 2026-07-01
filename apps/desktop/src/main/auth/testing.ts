import { AuthService, type AuthServiceOptions } from './AuthService';
import { InMemoryAccountStore } from './stores';
import type { PasswordHasher, SecureCipher } from './types';

/**
 * Test doubles for the auth ports. Used by unit/integration tests so they neither hit Electron
 * `safeStorage` nor pay the cost of real Argon2id. The real `Argon2Hasher` is exercised separately
 * to prove a genuine PHC verifier is produced.
 */
export class FakeHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return `fake$${password}`;
  }
  async verify(verifier: string, password: string): Promise<boolean> {
    return verifier === `fake$${password}`;
  }
}

/** Reversible, non-OS cipher: enough to assert the verifier is wrapped (not stored raw). */
export class IdentityCipher implements SecureCipher {
  isAvailable(): boolean {
    return true;
  }
  protect(plain: string): string {
    return `enc(${plain})`;
  }
  reveal(token: string): string {
    return token.slice(4, -1);
  }
}

export function makeTestAuthService(over: Partial<AuthServiceOptions> = {}): {
  service: AuthService;
  store: InMemoryAccountStore;
} {
  const store = (over.store as InMemoryAccountStore) ?? new InMemoryAccountStore();
  const service = new AuthService({
    store,
    cipher: new IdentityCipher(),
    hasher: new FakeHasher(),
    ...over,
  });
  return { service, store };
}
