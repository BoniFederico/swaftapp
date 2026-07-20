import { randomUUID } from 'node:crypto';
import {
  DEFAULT_SUBTYPE,
  type TemplateCreateRequest,
  type TemplateDto,
  type TemplateType,
  type WorkspaceTree,
} from '@swaft/shared';
import { AppError } from '../errors';
import type { ChangelogService } from './ChangelogService';
import { OrganizationService } from './OrganizationService';
import { RepoBase } from './RepoBase';
import type { WorkspaceService } from './WorkspaceService';

interface TemplateRow {
  id: string;
  folder_id: string;
  project_id: string | null;
  name: string;
  type: string;
  subtype: string | null;
  source: string;
  has_draft: number;
  created_at: string;
}

/** Starter source for a fresh document template — immediately renderable, shows one widget. */
const STARTER_SOURCE = "Hello ${ textbox({ id: 'name', label: 'Your name', type: string() }) }!";

/**
 * Starter source for a fresh `capability` template: a runnable example that shows the whole contract
 * — the declared value type, the `{ args, swaft }` parameter, and a JSON-only return.
 */
const STARTER_CAPABILITY_SOURCE = `// This capability is called from a formula by this template's name, e.g.
//   \${ myCapability({ id: 'cfg' }).baseUrl }
// The call's own fields arrive in \`args\` (\`id\` included); whatever you return must be JSON.

/** Seebo type of the resolved value: object (default), string, int, float, bool, array, … */
export const type = 'object';

export default async function ({ args, swaft }) {
  return {
    baseUrl: swaft.env.get('BASE_URL') ?? 'https://api.example.com',
    calledWith: args.id,
    at: swaft.now(),
  };
}
`;

/** The source a new template starts from, by kind. */
function starterSource(type: TemplateType): string {
  return type === 'capability' ? STARTER_CAPABILITY_SOURCE : STARTER_SOURCE;
}

/** Best-effort HTTP method for an `api` template (its source is the JSON request model). */
function extractHttpMethod(source: string): string | null {
  try {
    const parsed = JSON.parse(source) as { method?: unknown };
    return typeof parsed.method === 'string' ? parsed.method.toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * CRUD for 🟢 synchronized templates (M6 covers `document` templates). Mutations persist the `.swaft`
 * and return the fresh tree; reads return the full template incl. its draft source.
 */
export class TemplateService extends RepoBase {
  constructor(
    ws: WorkspaceService,
    private readonly org: OrganizationService,
    private readonly changelog: ChangelogService,
  ) {
    super(ws);
  }

  createTemplate(req: TemplateCreateRequest): Promise<WorkspaceTree> {
    // A template lives either in a folder (`folderId`) or at the project root (`projectId`).
    if (!req.folderId && !req.projectId) {
      throw new AppError(
        'INVALID_PARENT',
        'validation',
        'A template needs either a folder or a project.',
      );
    }
    const type = req.type ?? 'document';
    return this.commitTree(() =>
      this.insertEntity('templates', {
        id: randomUUID(),
        folder_id: req.folderId ?? '',
        project_id: req.folderId ? null : (req.projectId ?? null),
        name: req.name.trim(),
        type,
        // Always assign a subtype so the template groups correctly in the tree's Type view.
        subtype: req.subtype ?? DEFAULT_SUBTYPE[type as TemplateType],
        source: req.source ?? starterSource(type as TemplateType),
      }),
    );
  }

  renameTemplate(id: string, name: string): Promise<WorkspaceTree> {
    return this.commitTree(() => this.updateEntity('templates', id, { name: name.trim() }));
  }

  deleteTemplate(id: string): Promise<WorkspaceTree> {
    return this.commitTree(() => this.softDelete('templates', id));
  }

  async getTemplate(id: string): Promise<TemplateDto | null> {
    const row = await this.adapter.get<TemplateRow>(
      `SELECT id, folder_id, project_id, name, type, subtype, source, has_draft, created_at
       FROM templates WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    if (!row) return null;
    const tagRows = await this.adapter.all<{ tag_id: string }>(
      `SELECT tag_id FROM template_tags WHERE template_id = ? AND deleted_at IS NULL`,
      [id],
    );
    return {
      id: row.id,
      folderId: row.folder_id ? row.folder_id : null,
      projectId: row.folder_id ? null : (row.project_id ?? null),
      name: row.name,
      type: row.type as TemplateType,
      subtype: row.subtype,
      tagIds: tagRows.map((r) => r.tag_id),
      method: row.type === 'api' ? extractHttpMethod(row.source) : null,
      source: row.source,
      hasDraft: row.has_draft !== 0,
      createdAt: row.created_at,
    };
  }

  async requireTemplate(id: string): Promise<TemplateDto> {
    const template = await this.getTemplate(id);
    if (!template) throw new AppError('TEMPLATE_NOT_FOUND', 'not_found', 'Template not found.');
    return template;
  }

  /** The owning project of a template: its own `projectId` (root) or its folder's. Null if neither. */
  async projectIdOf(id: string): Promise<string | null> {
    const tpl = await this.requireTemplate(id);
    if (tpl.projectId) return tpl.projectId;
    if (tpl.folderId) {
      const row = await this.adapter.get<{ project_id: string | null }>(
        `SELECT project_id FROM folders WHERE id = ? AND deleted_at IS NULL`,
        [tpl.folderId],
      );
      return row?.project_id ?? null;
    }
    return null;
  }

  /**
   * Live templates of one kind, ordered by name, with the device that last wrote each. Used by the
   * user-capability registry: the device stamp tells code written on this install apart from code
   * that arrived with someone else's workspace.
   */
  async listByType(
    type: TemplateType,
  ): Promise<{ id: string; name: string; updated_by_device_id: string | null }[]> {
    return this.adapter.all<{ id: string; name: string; updated_by_device_id: string | null }>(
      `SELECT id, name, updated_by_device_id FROM templates
        WHERE type = ? AND deleted_at IS NULL
        ORDER BY name COLLATE NOCASE`,
      [type],
    );
  }

  async updateSource(
    id: string,
    source: string,
    subtype?: string | null,
  ): Promise<TemplateDto> {
    const patch: Record<string, string | null> = { source };
    if (subtype !== undefined) patch.subtype = subtype ?? null;
    await this.updateEntity('templates', id, patch);
    await this.changelog.addEntry('template', id, 'Draft saved');
    await this.ws.save();
    return this.requireTemplate(id);
  }

  private async commitTree(mutate: () => Promise<void>): Promise<WorkspaceTree> {
    await mutate();
    await this.ws.save();
    return this.org.getTree();
  }
}
