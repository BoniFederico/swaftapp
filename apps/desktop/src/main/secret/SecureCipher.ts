import { safeStorage } from 'electron';

/**
 * OS-backed secret protection port. A small seam so the {@link SecretService} never touches Electron
 * directly (and stays test-portable): production wraps values with `safeStorage`, tests use a fake.
 */
export interface SecureCipher {
  isAvailable(): boolean;
  /** Encrypt a UTF-8 string → opaque base64 token. */
  protect(plain: string): string;
  /** Reverse of `protect`. */
  reveal(token: string): string;
}

/**
 * OS-backed protection using Electron `safeStorage` (DPAPI on Windows, Keychain on macOS). Secrets
 * are wrapped with this before being written to disk, so they are never at rest in clear
 * (🟠 secure-local). Electron-only — imported solely by the main
 * bootstrap, never by the transport/handlers (which must stay test-portable).
 */
export class SafeStorageCipher implements SecureCipher {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  protect(plain: string): string {
    return safeStorage.encryptString(plain).toString('base64');
  }

  reveal(token: string): string {
    return safeStorage.decryptString(Buffer.from(token, 'base64'));
  }
}
