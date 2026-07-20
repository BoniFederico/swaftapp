import { randomUUID } from 'node:crypto';
import type {
  EnvCreateRequest,
  EnvironmentDto,
  EnvironmentOwnerKind,
  EnvironmentSummaryDto,
} from '@swaft/shared';
import { AppError } from '../errors';
import type { EnvDataProvider } from '../seebo/SeeboHost';
import type { SqlParam } from '../storage/sqlite';
import { RepoBase } from './RepoBase';
import type { WorkspaceService } from './WorkspaceService';

const SELECTION_ID = 'active';

interface EnvironmentRow {
  id: string;
  name: string;
  description: string | null;
  owner_kind: string;
  owner_id: string | null;
  vars: string;
}

/** Parse the stored `vars` JSON blob into a plain string→string map (tolerant of corruption). */
function parseVars(json: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = String(v);
    return out;
  } catch {
    return {};
  }
}

/**
 * Environments: named sets of plain (non-secret) key/value variables, 🟢 synchronized. Each is scoped
 * by `ownerKind` to the current user (personal) or the whole workspace (shared).
 * The active environment (a 🔵 local-only, per-workspace selection) feeds the `env(...)` Seebo data
 * capability, which resolves `env('KEY')` to the active environment's value **without user input**
 * (implements {@link EnvDataProvider}). See the API-view automation spec (Fase 3).
 */
export class EnvironmentService extends RepoBase implements EnvDataProvider {
  constructor(
    ws: WorkspaceService,
    private readonly currentUsername: () => string | null = () => null,
  ) {
    super(ws);
  }

  async list(): Promise<EnvironmentSummaryDto[]> {
    const rows = await this.adapter.all<EnvironmentRow>(
      `SELECT id, name, description, owner_kind, owner_id, vars
         FROM environments
        WHERE deleted_at IS NULL
        ORDER BY owner_kind, name COLLATE NOCASE`,
    );
    return rows.map((r) => this.toSummary(r));
  }

  async get(id: string): Promise<EnvironmentDto> {
    const row = await this.requireRow(id);
    return { ...this.toSummary(row), vars: parseVars(row.vars) };
  }

  async create(input: EnvCreateRequest): Promise<EnvironmentDto> {
    const ownerId = input.ownerKind === 'user' ? this.currentUsername() : null;
    const id = randomUUID();
    await this.insertEntity('environments', {
      id,
      name: input.name.trim(),
      description: input.description?.trim() ? input.description.trim() : null,
      owner_kind: input.ownerKind,
      owner_id: ownerId,
      vars: '{}',
    });
    await this.ws.save();
    return this.get(id);
  }

  async update(
    id: string,
    patch: { name?: string; description?: string | null; vars?: Record<string, string> },
  ): Promise<EnvironmentDto> {
    await this.requireRow(id);
    const set: Record<string, SqlParam> = {};
    if (patch.name !== undefined) set.name = patch.name.trim();
    if (patch.description !== undefined) {
      const d = patch.description?.trim();
      set.description = d ? d : null;
    }
    if (patch.vars !== undefined) set.vars = JSON.stringify(patch.vars);
    if (Object.keys(set).length > 0) {
      await this.updateEntity('environments', id, set);
      await this.ws.save();
    }
    return this.get(id);
  }

  async delete(id: string): Promise<EnvironmentSummaryDto[]> {
    await this.softDelete('environments', id);
    // If the deleted environment was active, clear the selection so nothing dangles.
    if ((await this.getSelection()) === id) await this.setSelection(null);
    await this.ws.save();
    return this.list();
  }

  // --- Active-environment selection (🔵 local-only) --------------------------

  async getSelection(): Promise<string | null> {
    const row = await this.adapter.get<{ environment_id: string | null }>(
      `SELECT environment_id FROM environment_selection WHERE id = ?`,
      [SELECTION_ID],
    );
    return row?.environment_id ?? null;
  }

  async setSelection(environmentId: string | null): Promise<string | null> {
    if (environmentId !== null) await this.requireRow(environmentId);
    await this.adapter.run(
      `INSERT OR REPLACE INTO environment_selection (id, environment_id, updated_at) VALUES (?, ?, ?)`,
      [SELECTION_ID, environmentId, this.ws.nowIso()],
    );
    await this.ws.save();
    return environmentId;
  }

  // --- `env(...)` data capability -------------------------------------------

  /**
   * Resolve `env('KEY')` to the active environment's value for `key`. Runs during the Seebo drive
   * loop (no user prompt). Throws when there is no active environment or the key is absent, so the
   * render surfaces a clear diagnostic instead of a silent empty string.
   */
  async resolve(key: string): Promise<unknown> {
    const name = key.trim();
    if (!name) {
      throw new AppError('ENV_KEY_REQUIRED', 'validation', 'env(...) requires a variable name.');
    }
    const activeId = await this.getSelection();
    if (!activeId) {
      throw new AppError(
        'ENV_NO_ACTIVE',
        'validation',
        `No active environment — select one to resolve env('${name}').`,
      );
    }
    const row = await this.adapter.get<EnvironmentRow>(
      `SELECT id, name, description, owner_kind, owner_id, vars FROM environments WHERE id = ? AND deleted_at IS NULL`,
      [activeId],
    );
    if (!row) {
      throw new AppError('ENV_NO_ACTIVE', 'validation', 'The active environment no longer exists.');
    }
    const vars = parseVars(row.vars);
    if (!(name in vars)) {
      throw new AppError(
        'ENV_VAR_NOT_FOUND',
        'not_found',
        `Variable "${name}" is not defined in the active environment "${row.name}".`,
      );
    }
    return vars[name];
  }

  private toSummary(row: EnvironmentRow): EnvironmentSummaryDto {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      ownerKind: row.owner_kind as EnvironmentOwnerKind,
      ownerId: row.owner_id,
      varCount: Object.keys(parseVars(row.vars)).length,
    };
  }

  private async requireRow(id: string): Promise<EnvironmentRow> {
    const row = await this.adapter.get<EnvironmentRow>(
      `SELECT id, name, description, owner_kind, owner_id, vars
         FROM environments
        WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    if (!row) throw new AppError('ENVIRONMENT_NOT_FOUND', 'not_found', 'Environment not found.');
    return row;
  }
}
