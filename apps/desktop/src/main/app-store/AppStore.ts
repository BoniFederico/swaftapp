import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Preferences, RecentWorkspace, WorkspaceSummary } from '@swaft/shared';

/**
 * App-level local store (🔵 local-only): a small JSON document in the user-data dir holding the
 * per-install device id, UI preferences (theme/color/language) and the recent-workspaces list.
 * Distinct from any `.swaft`. M4 wires the M2 preferences to persist here. See
 * SWAFT_DATA_MODEL.md §20, SWAFT_STORAGE_SYNC_MODEL.md §2.4.
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
        recent: Array.isArray(parsed.recent) ? parsed.recent : [],
        trustedCode:
          parsed.trustedCode && typeof parsed.trustedCode === 'object' ? parsed.trustedCode : {},
      };
    } catch {
      return empty;
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
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

  /** Upsert a workspace into the recent list (most-recent first, capped). */
  recordRecent(summary: WorkspaceSummary): void {
    const entry: RecentWorkspace = {
      path: summary.path,
      name: summary.name,
      encrypted: summary.encrypted,
      lastOpenedAt: this.now().toISOString(),
    };
    const others = this.data.recent.filter((r) => r.path !== summary.path);
    this.data.recent = [entry, ...others].slice(0, RECENT_LIMIT);
    this.persist();
  }
}
