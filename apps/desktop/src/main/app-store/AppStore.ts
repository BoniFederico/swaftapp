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
    const empty: AppStoreData = { deviceId: '', preferences: {}, recent: [] };
    if (!existsSync(this.filePath)) return empty;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<AppStoreData>;
      return {
        deviceId: parsed.deviceId ?? '',
        preferences: parsed.preferences ?? {},
        recent: Array.isArray(parsed.recent) ? parsed.recent : [],
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
