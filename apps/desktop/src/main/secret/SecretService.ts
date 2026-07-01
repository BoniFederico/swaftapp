import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SecureCipher } from '../auth/types';

interface SecretFile {
  secrets: Record<string, string>;
}

/**
 * 🟠 secure-local secrets store (API keys, tokens). Values are wrapped with the OS-backed cipher
 * (`safeStorage`) and kept in the user-data dir — **never** in `.swaft`, never synchronized, never
 * returned to the renderer (the renderer holds opaque `secretRef`s only). See SWAFT_SECURITY_MODEL §9.
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
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
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
