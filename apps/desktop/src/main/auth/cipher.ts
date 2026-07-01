import { safeStorage } from 'electron';
import type { SecureCipher } from './types';

/**
 * OS-backed verifier protection using Electron `safeStorage` (DPAPI on Windows, Keychain on macOS).
 * The Argon2id verifier is wrapped with this before being written to the account file, so it is
 * never at rest in clear (🟠 secure-local, SWAFT_SECURITY_MODEL.md §3a). Electron-only — imported
 * solely by the main bootstrap, never by the transport/handlers (which must stay test-portable).
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
