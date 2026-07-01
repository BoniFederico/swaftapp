import { randomUUID } from 'node:crypto';
import type {
  AuthProfile,
  AuthStatusResponse,
  SignInRequest,
  SignUpRequest,
  UnlockRequest,
  WhoamiResponse,
} from '@swaft/shared';
import { AppError } from '../errors';
import type { AccountRecord, AccountStore, PasswordHasher, SecureCipher, Session } from './types';

/**
 * A coded auth failure (an {@link AppError}). Handlers translate it to the transport error envelope;
 * the codes/categories are part of the contract (SWAFT_SECURITY_MODEL.md §3a). Messages are GENERIC
 * for credential failures (no user enumeration).
 */
export class AuthError extends AppError {
  constructor(code: string, category: AppError['category'], message: string, details?: Record<string, unknown>) {
    super(code, category, message, details);
    this.name = 'AuthError';
  }
}

export interface AuthServiceOptions {
  store: AccountStore;
  cipher: SecureCipher;
  hasher: PasswordHasher;
  /** Failed attempts before a lockout window opens (default 5). */
  maxAttempts?: number;
  /** Base lockout window once tripped; doubles per extra failure (default 30s). */
  baseLockoutMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

/**
 * Local multi-account authentication + session authority. Multiple accounts may exist on one device;
 * the session (a single signed-in user) lives ONLY in memory in the main process (never persisted,
 * never sent to the renderer). Passwords are verified here against an Argon2id verifier kept
 * (OS-protected) in the account store; the verifier never leaves this process.
 * See SWAFT_SECURITY_MODEL.md §3a, SWAFT_DATA_MODEL.md §20.
 */
export class AuthService {
  private readonly store: AccountStore;
  private readonly cipher: SecureCipher;
  private readonly hasher: PasswordHasher;
  private readonly maxAttempts: number;
  private readonly baseLockoutMs: number;
  private readonly now: () => number;

  /** Active session, or null. */
  private session: Session | null = null;
  /** The username whose session was locked (distinguishes `locked` from `signed-out`). */
  private lockedUsername: string | null = null;

  constructor(opts: AuthServiceOptions) {
    this.store = opts.store;
    this.cipher = opts.cipher;
    this.hasher = opts.hasher;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.baseLockoutMs = opts.baseLockoutMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  // --- Queries --------------------------------------------------------------

  status(): AuthStatusResponse {
    if (this.store.list().length === 0) return { state: 'needs-setup', profile: null };
    if (this.session) {
      const record = this.store.get(this.session.username);
      return { state: 'signed-in', profile: record ? this.profileOf(record) : null };
    }
    if (this.lockedUsername) {
      const record = this.store.get(this.lockedUsername);
      return { state: 'locked', profile: record ? this.profileOf(record) : null };
    }
    return { state: 'signed-out', profile: null };
  }

  isSignedIn(): boolean {
    return this.session !== null;
  }

  /** The signed-in username, or null. Used to attribute synchronized changes (changelog). */
  currentUsername(): string | null {
    return this.session?.username ?? null;
  }

  whoami(): WhoamiResponse {
    if (!this.session) throw new AuthError('NO_SESSION', 'auth', 'No active session.');
    const record = this.store.get(this.session.username);
    return {
      profile: {
        username: this.session.username,
        displayName: record?.displayName ?? this.session.username,
      },
      sessionSince: this.session.since,
    };
  }

  // --- Commands -------------------------------------------------------------

  async signUp(req: SignUpRequest): Promise<AuthStatusResponse> {
    if (this.store.get(req.username)) {
      throw new AuthError('USERNAME_TAKEN', 'validation', 'That username is already taken.');
    }
    const verifier = await this.hasher.hash(req.password);
    const record: AccountRecord = {
      username: req.username,
      displayName: req.displayName?.trim() || req.username,
      protectedVerifier: this.cipher.protect(verifier),
      createdAt: new Date(this.now()).toISOString(),
      failedAttempts: 0,
      lockedUntil: null,
    };
    this.store.upsert(record);
    this.startSession(record.username);
    return { state: 'signed-in', profile: this.profileOf(record) };
  }

  async signIn(req: SignInRequest): Promise<AuthStatusResponse> {
    const record = this.store.get(req.username);
    // Generic failure for an unknown username → no account enumeration via this op.
    if (!record) throw this.invalidCredentials();
    this.ensureNotLockedOut(record);

    if (!(await this.tryPassword(record, req.password))) this.registerFailure(record); // throws

    this.registerSuccess(record);
    this.startSession(record.username);
    return { state: 'signed-in', profile: this.profileOf(record) };
  }

  async unlock(req: UnlockRequest): Promise<AuthStatusResponse> {
    if (!this.lockedUsername) throw new AuthError('NO_SESSION', 'auth', 'Nothing to unlock.');
    const record = this.store.get(this.lockedUsername);
    if (!record) {
      this.lockedUsername = null;
      throw this.invalidCredentials();
    }
    this.ensureNotLockedOut(record);

    if (!(await this.tryPassword(record, req.password))) this.registerFailure(record); // throws

    this.registerSuccess(record);
    this.startSession(record.username);
    return { state: 'signed-in', profile: this.profileOf(record) };
  }

  signOut(): AuthStatusResponse {
    this.session = null;
    this.lockedUsername = null;
    return this.status();
  }

  lock(): AuthStatusResponse {
    if (this.session) {
      this.lockedUsername = this.session.username;
      this.session = null;
    }
    return this.status();
  }

  // --- Internals ------------------------------------------------------------

  private profileOf(record: AccountRecord): AuthProfile {
    return { username: record.username, displayName: record.displayName };
  }

  private startSession(username: string): void {
    this.session = { id: randomUUID(), username, since: new Date(this.now()).toISOString() };
    this.lockedUsername = null;
  }

  private async tryPassword(record: AccountRecord, password: string): Promise<boolean> {
    const verifier = this.cipher.reveal(record.protectedVerifier);
    return this.hasher.verify(verifier, password);
  }

  private ensureNotLockedOut(record: AccountRecord): void {
    if (record.lockedUntil !== null && this.now() < record.lockedUntil) {
      throw new AuthError('ACCOUNT_LOCKED', 'auth', 'Too many attempts. Try again later.', {
        retryAfterMs: record.lockedUntil - this.now(),
      });
    }
  }

  private registerSuccess(record: AccountRecord): void {
    record.failedAttempts = 0;
    record.lockedUntil = null;
    this.store.upsert(record);
  }

  /** Persist a failed attempt (escalating lockout) and throw a generic credential error. */
  private registerFailure(record: AccountRecord): never {
    record.failedAttempts += 1;
    if (record.failedAttempts >= this.maxAttempts) {
      const over = Math.min(record.failedAttempts - this.maxAttempts, 5);
      record.lockedUntil = this.now() + this.baseLockoutMs * 2 ** over;
    }
    this.store.upsert(record);
    throw this.invalidCredentials();
  }

  private invalidCredentials(): AuthError {
    return new AuthError('INVALID_CREDENTIALS', 'auth', 'Invalid username or password.');
  }
}
