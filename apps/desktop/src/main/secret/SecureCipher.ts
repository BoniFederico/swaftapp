import { safeStorage } from 'electron';
import type { SecretStorageLevel } from '@swaft/shared';
import { AppError } from '../errors';

/**
 * OS-backed secret protection port. A small seam so the {@link SecretService} never touches Electron
 * directly (and stays test-portable): production wraps values with `safeStorage`, tests use a fake.
 */
export interface SecureCipher {
  isAvailable(): boolean;
  /** How strongly values are protected at rest (defaults to secure/unavailable from `isAvailable`). */
  level?(): SecretStorageLevel;
  /** Encrypt a UTF-8 string → opaque base64 token. */
  protect(plain: string): string;
  /** Reverse of `protect`. */
  reveal(token: string): string;
}

/**
 * OS-backed protection using Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, the Secret
 * Service / KWallet on Linux). Secrets are wrapped with this before being written to disk, so they
 * are never at rest in clear (🟠 secure-local). Electron-only — imported solely by the main
 * bootstrap, never by the transport/handlers (which must stay test-portable).
 */
export class SafeStorageCipher implements SecureCipher {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  level(): SecretStorageLevel {
    if (!this.isAvailable()) return 'unavailable';
    // On Linux without a keyring Electron silently uses a hard-coded key ("basic_text").
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
      return 'weak';
    }
    return 'secure';
  }

  protect(plain: string): string {
    if (!this.isAvailable()) {
      throw new AppError(
        'SECRET_STORAGE_UNAVAILABLE',
        'policy',
        'The operating system offers no secure storage, so secrets cannot be saved on this machine.',
      );
    }
    return safeStorage.encryptString(plain).toString('base64');
  }

  reveal(token: string): string {
    return safeStorage.decryptString(Buffer.from(token, 'base64'));
  }
}
