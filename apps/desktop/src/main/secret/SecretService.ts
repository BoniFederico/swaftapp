import { existsSync, readFileSync } from 'node:fs';
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
  ) {
    this.data = this.load();
  }

  private load(): SecretFile {
    if (!existsSync(this.filePath)) return { secrets: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<SecretFile>;
      return { secrets: parsed.secrets ?? {} };
    } catch {
      return { secrets: {} };
    }
  }

  private persist(): void {
    writeFileAtomicSync(this.filePath, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  set(ref: string, value: string): void {
    this.data.secrets[ref] = this.cipher.protect(value);
    this.persist();
  }

  /** Reveal a secret (main-process only). */
  get(ref: string): string | null {
    const protectedValue = this.data.secrets[ref];
    return protectedValue ? this.cipher.reveal(protectedValue) : null;
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
