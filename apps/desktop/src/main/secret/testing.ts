import type { SecureCipher } from './SecureCipher';

/** Reversible, non-OS cipher for tests: enough to assert a value is wrapped (not stored raw). */
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
