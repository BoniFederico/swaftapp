import { randomUUID } from 'node:crypto';
import type {
  ExecutionMode,
  RestrictionDto,
  WorkspaceSettingsDto,
  WorkspaceSettingsUpdate,
} from '@swaft/shared';
import { AppError } from '../errors';
import type { SqlParam } from '../storage/sqlite';
import { RepoBase } from './RepoBase';

const SETTINGS_ID = 'settings';

interface SettingsRow {
  id: string;
  execution_mode: string;
  allowed_types: string;
  allowed_subtypes: string;
  allowed_capabilities: string;
  allowed_actions: string;
  allowed_domains: string;
  proxy_url: string | null;
  file_export_root: string | null;
}
interface RestrictionRow {
  id: string;
  kind: string;
  value: string;
}

function parseList(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Workspace settings + restrictions (🟢 synchronized). Holds the execution mode, allowed HTTP
 * domains / actions / capabilities, proxy (non-secret) and file-export root. Switching to the `dev`
 * execution mode is **gated** by an explicit confirmation (SWAFT_SECURITY_MODEL.md §8). The settings
 * row is created lazily with safe defaults. See SWAFT_DATA_MODEL.md §6.
 */
export class SettingsService extends RepoBase {
  async getSettings(): Promise<WorkspaceSettingsDto> {
    const row = await this.ensureRow();
    return {
      executionMode: row.execution_mode as ExecutionMode,
      allowedTypes: parseList(row.allowed_types),
      allowedSubtypes: parseList(row.allowed_subtypes),
      allowedCapabilities: parseList(row.allowed_capabilities),
      allowedActions: parseList(row.allowed_actions),
      allowedDomains: parseList(row.allowed_domains),
      proxyUrl: row.proxy_url,
      fileExportRoot: row.file_export_root,
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
    if (patch.allowedTypes !== undefined) set.allowed_types = JSON.stringify(patch.allowedTypes);
    if (patch.allowedSubtypes !== undefined)
      set.allowed_subtypes = JSON.stringify(patch.allowedSubtypes);
    if (patch.allowedCapabilities !== undefined)
      set.allowed_capabilities = JSON.stringify(patch.allowedCapabilities);
    if (patch.allowedActions !== undefined) set.allowed_actions = JSON.stringify(patch.allowedActions);
    if (patch.allowedDomains !== undefined) set.allowed_domains = JSON.stringify(patch.allowedDomains);
    if (patch.proxyUrl !== undefined) set.proxy_url = patch.proxyUrl;
    if (patch.fileExportRoot !== undefined) set.file_export_root = patch.fileExportRoot;

    if (Object.keys(set).length > 0) {
      await this.updateEntity('workspace_settings', SETTINGS_ID, set);
      await this.ws.save();
    }
    return this.getSettings();
  }

  async listRestrictions(): Promise<RestrictionDto[]> {
    const rows = await this.adapter.all<RestrictionRow>(
      `SELECT id, kind, value FROM restrictions WHERE deleted_at IS NULL ORDER BY kind, value`,
    );
    return rows.map((r) => ({ id: r.id, kind: r.kind, value: r.value }));
  }

  async createRestriction(input: { kind: string; value: string }): Promise<RestrictionDto[]> {
    await this.insertEntity('restrictions', {
      id: randomUUID(),
      kind: input.kind.trim(),
      value: input.value.trim(),
    });
    await this.ws.save();
    return this.listRestrictions();
  }

  async deleteRestriction(id: string): Promise<RestrictionDto[]> {
    await this.softDelete('restrictions', id);
    await this.ws.save();
    return this.listRestrictions();
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
      allowed_types: '[]',
      allowed_subtypes: '[]',
      allowed_capabilities: '[]',
      allowed_actions: '[]',
      allowed_domains: '[]',
      proxy_url: null,
      file_export_root: null,
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
