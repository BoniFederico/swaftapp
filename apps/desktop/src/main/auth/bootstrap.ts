import { join } from 'node:path';
import { app } from 'electron';
import { Argon2Hasher } from './argon2-hasher';
import { SafeStorageCipher } from './cipher';
import { FileAccountStore } from './stores';
import { AuthService } from './AuthService';
import { setAuthService } from './registry';
import { setSessionGate } from '../transport/session';

/**
 * Construct the real, Electron-backed AuthService and wire it into the transport layer:
 *  - account record persisted in the user-data dir (NOT a `.swaft`),
 *  - verifier protected at rest via OS `safeStorage`,
 *  - Argon2id password hashing,
 *  - the session gate the dispatcher consults for the session guard.
 * Electron-only; called once from the main entry. Never imported by the transport/handlers (which
 * stay test-portable).
 */
export function bootstrapAuth(): AuthService {
  const accountFile = join(app.getPath('userData'), 'account.json');
  const service = new AuthService({
    store: new FileAccountStore(accountFile),
    cipher: new SafeStorageCipher(),
    hasher: new Argon2Hasher(),
  });
  setAuthService(service);
  setSessionGate({ isSignedIn: () => service.isSignedIn() });
  return service;
}
