import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { argon2id } from 'hash-wasm';
import { AppError } from '../errors';

/**
 * Optional whole-file encryption for `.swaft` workspaces. The serialized
 * SQLite image is wrapped with **AES-256-GCM** under a key derived from the user's workspace password
 * via **Argon2id** (per-file random salt). Encryption is workspace-scoped and SEPARATE from account
 * sign-in (resolved OD-S7).
 *
 * ⚠️ Unrecoverable by design: there is no key escrow/recovery. Losing the password loses the data —
 * the wizard must show this warning before enabling encryption.
 *
 * File envelope: MAGIC(8) ‖ salt(16) ‖ iv(12) ‖ authTag(16) ‖ ciphertext.
 */
const MAGIC = Buffer.from('SWAFTC01', 'utf8');
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

const KDF = { memorySize: 19456, iterations: 2, parallelism: 1, hashLength: 32 } as const;

export class CryptoService {
  /** Derive a 32-byte AES key from a password + salt using Argon2id. */
  private async deriveKey(password: string, salt: Uint8Array): Promise<Buffer> {
    const raw = await argon2id({ password, salt, ...KDF, outputType: 'binary' });
    return Buffer.from(raw);
  }

  /** True when bytes carry the encrypted-workspace envelope header. */
  isEncrypted(file: Uint8Array): boolean {
    return file.length >= MAGIC.length && Buffer.from(file.subarray(0, MAGIC.length)).equals(MAGIC);
  }

  async encrypt(plain: Uint8Array, password: string): Promise<Uint8Array> {
    const salt = randomBytes(SALT_LEN);
    const iv = randomBytes(IV_LEN);
    const key = await this.deriveKey(password, salt);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([MAGIC, salt, iv, tag, ciphertext]);
  }

  async decrypt(file: Uint8Array, password: string): Promise<Uint8Array> {
    if (!this.isEncrypted(file)) {
      throw new AppError('NOT_ENCRYPTED', 'validation', 'File is not an encrypted workspace.');
    }
    const buf = Buffer.from(file);
    let offset = MAGIC.length;
    const salt = buf.subarray(offset, (offset += SALT_LEN));
    const iv = buf.subarray(offset, (offset += IV_LEN));
    const tag = buf.subarray(offset, (offset += TAG_LEN));
    const ciphertext = buf.subarray(offset);

    const key = await this.deriveKey(password, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      // GCM auth failure → wrong password (or tampered file). Generic, no detail leak.
      throw new AppError(
        'WRONG_WORKSPACE_PASSWORD',
        'validation',
        'Incorrect workspace password.',
      );
    }
  }
}
