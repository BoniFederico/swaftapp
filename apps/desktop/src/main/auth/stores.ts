import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AccountRecord, AccountStore } from './types';

interface AccountFile {
  accounts: AccountRecord[];
}

/**
 * File-backed account store: a small JSON document in the app's user-data dir (NOT a `.swaft`).
 * Holds the device's local accounts — non-secret profile/lockout metadata plus each
 * **already-protected** verifier (the SecureCipher wraps it before it ever reaches here). Accounts
 * are keyed by username. See SWAFT_DATA_MODEL.md §20.
 */
export class FileAccountStore implements AccountStore {
  constructor(private readonly filePath: string) {}

  private readAll(): AccountRecord[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<AccountFile> &
        Partial<AccountRecord>;
      if (Array.isArray(parsed.accounts)) return parsed.accounts;
      // Backward-compat: a pre-multi-account file stored a single record at the top level.
      if (typeof parsed.username === 'string' && typeof parsed.protectedVerifier === 'string') {
        return [parsed as AccountRecord];
      }
      return [];
    } catch {
      return [];
    }
  }

  private writeAll(accounts: AccountRecord[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const data: AccountFile = { accounts };
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  list(): AccountRecord[] {
    return this.readAll();
  }

  get(username: string): AccountRecord | null {
    return this.readAll().find((a) => a.username === username) ?? null;
  }

  upsert(record: AccountRecord): void {
    const others = this.readAll().filter((a) => a.username !== record.username);
    this.writeAll([...others, record]);
  }

  remove(username: string): void {
    this.writeAll(this.readAll().filter((a) => a.username !== username));
  }

  clear(): void {
    if (existsSync(this.filePath)) rmSync(this.filePath);
  }
}

/** In-memory account store for tests. */
export class InMemoryAccountStore implements AccountStore {
  private readonly accounts = new Map<string, AccountRecord>();

  list(): AccountRecord[] {
    return [...this.accounts.values()].map((r) => ({ ...r }));
  }

  get(username: string): AccountRecord | null {
    const record = this.accounts.get(username);
    return record ? { ...record } : null;
  }

  upsert(record: AccountRecord): void {
    this.accounts.set(record.username, { ...record });
  }

  remove(username: string): void {
    this.accounts.delete(username);
  }

  clear(): void {
    this.accounts.clear();
  }
}
