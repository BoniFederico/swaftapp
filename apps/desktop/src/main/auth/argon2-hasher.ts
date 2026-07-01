import { randomBytes } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';
import type { PasswordHasher } from './types';

/**
 * Argon2id password hasher (SWAFT_SECURITY_MODEL.md §3a). Produces a self-describing PHC verifier
 * (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`) so parameters travel with the hash and verification
 * needs no external config. Pure-WASM (`hash-wasm`): identical behaviour in the Electron main process
 * and in Node test runners, with no native build/ABI concerns.
 *
 * Parameters follow the OWASP Argon2id baseline (m=19 MiB, t=2, p=1). Tunable for tests via the
 * constructor to keep unit tests fast.
 */
export interface Argon2Params {
  /** Memory cost in KiB. */
  memorySize: number;
  /** Time cost (iterations). */
  iterations: number;
  parallelism: number;
  hashLength: number;
  saltLength: number;
}

export const DEFAULT_ARGON2_PARAMS: Argon2Params = {
  memorySize: 19456, // 19 MiB
  iterations: 2,
  parallelism: 1,
  hashLength: 32,
  saltLength: 16,
};

export class Argon2Hasher implements PasswordHasher {
  constructor(private readonly params: Argon2Params = DEFAULT_ARGON2_PARAMS) {}

  async hash(password: string): Promise<string> {
    const salt = new Uint8Array(randomBytes(this.params.saltLength));
    return argon2id({
      password,
      salt,
      memorySize: this.params.memorySize,
      iterations: this.params.iterations,
      parallelism: this.params.parallelism,
      hashLength: this.params.hashLength,
      outputType: 'encoded',
    });
  }

  async verify(verifier: string, password: string): Promise<boolean> {
    try {
      return await argon2Verify({ password, hash: verifier });
    } catch {
      // Malformed/foreign verifier → treat as a non-match, never throw to the caller.
      return false;
    }
  }
}
