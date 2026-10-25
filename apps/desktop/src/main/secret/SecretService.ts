import { existsSync, readFileSync, renameSync } from 'node:fs';
import type { SecretStorageLevel } from '@swaft/shared';
import { AppError } from '../errors';
import { writeFileAtomicSync } from '../storage/atomic-file';
import type { SecureCipher } from './SecureCipher';

interface SecretFile {
  secrets: Record<string, string>;
}

/**
 * 🟠 secure-local secrets store (API keys, tokens). Values are wrapped with the OS-backed cipher
 * (`safeStorage`) and kept in the user-data dir — **never** in `.swaft`, never synchronized, never
 * returned to the renderer (the renderer holds opaque `secretRef`s only).
 */
export class SecretService {
  private data: SecretFile;

  constructor(
    private readonly filePath: string,
    private readonly cipher: SecureCipher,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.data = this.load();
  }

  private load(): SecretFile {
    if (!existsSync(this.filePath)) return { secrets: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<SecretFile>;
      return { secrets: parsed.secrets ?? {} };
    } catch (e) {
      // Never let the next save overwrite an unreadable store: set it aside so it can be recovered.
      const backup = `${this.filePath}.corrupt-${this.now().getTime()}`;
      try {
        renameSync(this.filePath, backup);
        console.error(`[secrets] unreadable secrets file moved to ${backup}:`, e);
      } catch (renameErr) {
        console.error('[secrets] unreadable secrets file could not be moved aside:', renameErr);
      }
      return { secrets: {} };
    }
  }

  private persist(): void {
    writeFileAtomicSync(this.filePath, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  /** How well stored secrets are protected on this machine (shown as a warning when not secure). */
  storageLevel(): SecretStorageLevel {
    return this.cipher.level?.() ?? (this.cipher.isAvailable() ? 'secure' : 'unavailable');
  }

  set(ref: string, value: string): void {
    this.data.secrets[ref] = this.cipher.protect(value);
    this.persist();
  }

  /** Reveal a secret (main-process only). */
  get(ref: string): string | null {
    const protectedValue = this.data.secrets[ref];
    if (!protectedValue) return null;
    try {
      return this.cipher.reveal(protectedValue);
    } catch {
      // Typically a profile copied from another machine/user, or a reset OS keyring.
      throw new AppError(
        'SECRET_UNREADABLE',
        'policy',
        `Secret "${ref}" can no longer be decrypted on this machine. Set its value again in Settings → Secrets.`,
      );
    }
  }

  /** Non-secret list of secret references (safe for the renderer). */
  list(): string[] {
    return Object.keys(this.data.secrets).sort();
  }

  delete(ref: string): void {
    delete this.data.secrets[ref];
    this.persist();
  }
}
