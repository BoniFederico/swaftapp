import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { normalize } from 'node:path';
import { writeFileAtomicSync } from '../storage/atomic-file';
import type { Preferences, RecentWorkspace, WorkspaceSummary } from '@swaft/shared';

/**
 * A stable identity key for a workspace path, used to keep the recent list unique. The same file can
 * reach us under different spellings — mixed `/` and `\` separators, `.`/`..` segments, a trailing
 * slash, and (on Windows, where the filesystem is case-insensitive) different casing. Normalizing the
 * separators/segments and case-folding on Windows makes those collapse to one entry.
 */
function recentKey(path: string): string {
  const n = normalize(path).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

/**
 * App-level local store (🔵 local-only): a small JSON document in the user-data dir holding the
 * per-install device id, UI preferences (theme/color/language) and the recent-workspaces list.
 * Distinct from any `.swaft`. M4 wires the M2 preferences to persist here.
 */
interface AppStoreData {
  deviceId: string;
  preferences: Preferences;
  recent: RecentWorkspace[];
  /**
   * Approved user code, per workspace path → template id → the exact source hash approved.
   *
   * This lives here, and **not** in the `.swaft`, on purpose: a workspace file is the thing that
   * gets shared, so trust stored inside it would travel with the code it is meant to vouch for and
   * sign itself. Keying on the hash means an edit revokes the approval automatically.
   */
  trustedCode: Record<string, Record<string, string>>;
}

const RECENT_LIMIT = 10;

export class AppStore {
  private data: AppStoreData;

  constructor(
    private readonly filePath: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.data = this.load();
    if (!this.data.deviceId) {
      this.data.deviceId = randomUUID();
      this.persist();
    }
  }

  private load(): AppStoreData {
    const empty: AppStoreData = { deviceId: '', preferences: {}, recent: [], trustedCode: {} };
    if (!existsSync(this.filePath)) return empty;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<AppStoreData>;
      return {
        deviceId: parsed.deviceId ?? '',
        preferences: parsed.preferences ?? {},
        // De-duplicate any list persisted before uniqueness was enforced (keeps the first/most-recent).
      recent: dedupeRecent(Array.isArray(parsed.recent) ? parsed.recent : []),
        trustedCode:
          parsed.trustedCode && typeof parsed.trustedCode === 'object' ? parsed.trustedCode : {},
      };
    } catch {
      return empty;
    }
  }

  private persist(): void {
    writeFileAtomicSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  getDeviceId(): string {
    return this.data.deviceId;
  }

  getPreferences(): Preferences {
    return { ...this.data.preferences };
  }

  setPreferences(patch: Preferences): Preferences {
    this.data.preferences = { ...this.data.preferences, ...patch };
    this.persist();
    return this.getPreferences();
  }

  getRecent(): RecentWorkspace[] {
    return this.data.recent.map((r) => ({ ...r }));
  }

  /** Has this exact source been approved to run, for this workspace and template? */
  isCodeTrusted(workspacePath: string, templateId: string, sourceHash: string): boolean {
    return this.data.trustedCode[workspacePath]?.[templateId] === sourceHash;
  }

  /** Approve one template's current source. Editing it changes the hash and revokes this. */
  trustCode(workspacePath: string, templateId: string, sourceHash: string): void {
    const forWorkspace = (this.data.trustedCode[workspacePath] ??= {});
    forWorkspace[templateId] = sourceHash;
    this.persist();
  }

  /** Upsert a workspace into the recent list (unique by normalized path, most-recent first, capped). */
  recordRecent(summary: WorkspaceSummary): void {
    const entry: RecentWorkspace = {
      path: summary.path,
      name: summary.name,
      encrypted: summary.encrypted,
      lastOpenedAt: this.now().toISOString(),
    };
    const key = recentKey(summary.path);
    const others = this.data.recent.filter((r) => recentKey(r.path) !== key);
    this.data.recent = [entry, ...others].slice(0, RECENT_LIMIT);
    this.persist();
  }

  /** Drop a workspace from the recent list (the file itself is untouched). Idempotent. */
  removeRecent(path: string): void {
    const key = recentKey(path);
    const next = this.data.recent.filter((r) => recentKey(r.path) !== key);
    if (next.length === this.data.recent.length) return; // nothing to do
    this.data.recent = next;
    this.persist();
  }
}

/** Keep the first occurrence of each normalized path, preserving order (most-recent first). */
function dedupeRecent(items: RecentWorkspace[]): RecentWorkspace[] {
  const seen = new Set<string>();
  const out: RecentWorkspace[] = [];
  for (const item of items) {
    const key = recentKey(item.path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
