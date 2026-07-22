import type { ExecutionMode, WorkspaceSettingsDto, WorkspaceSettingsUpdate } from '@swaft/shared';
import { AppError } from '../errors';
import type { SqlParam } from '../storage/sqlite';
import { parseStringList, parseStringMap } from '../util/json';
import { RepoBase } from './RepoBase';

const SETTINGS_ID = 'settings';

interface SettingsRow {
  id: string;
  execution_mode: string;
  blocked_domains: string;
  proxy_url: string | null;
  enforced_headers: string;
  batcher_enabled: number;
}

/**
 * Workspace settings (🟢 synchronized): the execution mode plus the outgoing-HTTP restrictions —
 * blocked domains, enforced proxy and enforced headers (all applied by HttpService). Switching to
 * the `dev` execution mode is **gated** by an explicit confirmation.
 * The settings row is created lazily with safe defaults.
 */
export class SettingsService extends RepoBase {
  async getSettings(): Promise<WorkspaceSettingsDto> {
    const row = await this.ensureRow();
    return {
      executionMode: row.execution_mode as ExecutionMode,
      batcherEnabled: row.batcher_enabled !== 0,
      blockedDomains: parseStringList(row.blocked_domains),
      proxyUrl: row.proxy_url,
      enforcedHeaders: parseStringMap(row.enforced_headers),
    };
  }

  async updateSettings(patch: WorkspaceSettingsUpdate): Promise<WorkspaceSettingsDto> {
    await this.ensureRow();
    if (patch.executionMode === 'dev' && !patch.confirmDev) {
      throw new AppError(
        'DEV_CONFIRMATION_REQUIRED',
        'policy',
        'Switching to developer execution mode requires explicit confirmation.',
      );
    }
    const set: Record<string, SqlParam> = {};
    if (patch.executionMode !== undefined) set.execution_mode = patch.executionMode;
    if (patch.batcherEnabled !== undefined) set.batcher_enabled = patch.batcherEnabled ? 1 : 0;
    if (patch.blockedDomains !== undefined)
      set.blocked_domains = JSON.stringify(patch.blockedDomains);
    if (patch.proxyUrl !== undefined) set.proxy_url = patch.proxyUrl;
    if (patch.enforcedHeaders !== undefined)
      set.enforced_headers = JSON.stringify(patch.enforcedHeaders);

    if (Object.keys(set).length > 0) {
      await this.updateEntity('workspace_settings', SETTINGS_ID, set);
      await this.ws.save();
    }
    return this.getSettings();
  }

  /** Return the settings row, creating it with safe defaults on first access. */
  private async ensureRow(): Promise<SettingsRow> {
    const existing = await this.adapter.get<SettingsRow>(
      `SELECT * FROM workspace_settings WHERE id = ? AND deleted_at IS NULL`,
      [SETTINGS_ID],
    );
    if (existing) return existing;
    await this.insertEntity('workspace_settings', {
      id: SETTINGS_ID,
      execution_mode: 'sandbox',
      blocked_domains: '[]',
      proxy_url: null,
      enforced_headers: '{}',
    });
    await this.ws.save();
    const created = await this.adapter.get<SettingsRow>(
      `SELECT * FROM workspace_settings WHERE id = ?`,
      [SETTINGS_ID],
    );
    if (!created) throw new AppError('INTERNAL', 'internal', 'Failed to initialize settings.');
    return created;
  }
}
