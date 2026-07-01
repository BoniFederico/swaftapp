import type { AuthProfile } from '@swaft/shared';

/**
 * Auth domain ports (interfaces). The AuthService depends ONLY on these, so it stays pure and
 * unit-testable without Electron: the real app injects an Electron-backed cipher + a file store +
 * the Argon2id hasher; tests inject in-memory fakes. See SWAFT_SECURITY_MODEL.md §3a.
 */

/** Persisted local-account record. Lives in the user-data dir, distinct from any `.swaft`. */
export interface AccountRecord {
  username: string;
  displayName: string;
  /**
   * The Argon2id verifier (PHC string) AFTER being wrapped by the SecureCipher (safeStorage).
   * Never stored in clear; never sent to the renderer. (🟠 secure-local)
   */
  protectedVerifier: string;
  createdAt: string;
  /** Consecutive failed sign-in/unlock attempts since the last success. */
  failedAttempts: number;
  /** Epoch-ms until which sign-in/unlock is locked out, or null. */
  lockedUntil: number | null;
}

/** Persistence port for the local account records (multiple accounts per device, keyed by username). */
export interface AccountStore {
  list(): AccountRecord[];
  get(username: string): AccountRecord | null;
  upsert(record: AccountRecord): void;
  remove(username: string): void;
  clear(): void;
}

/**
 * Reversible protection for the verifier at rest (OS-backed in production via `safeStorage`).
 * `isAvailable()` lets the bootstrap fall back / warn when the OS keychain is unavailable.
 */
export interface SecureCipher {
  isAvailable(): boolean;
  /** Encrypt a UTF-8 string → opaque base64 token. */
  protect(plain: string): string;
  /** Reverse of `protect`. */
  reveal(token: string): string;
}

/** One-way password hashing port (Argon2id in production). */
export interface PasswordHasher {
  /** Produce a self-describing verifier (PHC string) for a password. */
  hash(password: string): Promise<string>;
  /** Constant-time verify of a password against a verifier. */
  verify(verifier: string, password: string): Promise<boolean>;
}

/** In-memory session held by the main process (never persisted, never on disk). */
export interface Session {
  id: string;
  username: string;
  since: string;
}

export type { AuthProfile };
