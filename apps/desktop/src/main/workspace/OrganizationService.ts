import { randomUUID } from 'node:crypto';
import type {
  FolderDetailDto,
  FolderDto,
  FolderProxyDto,
  HttpAuth,
  ProjectDto,
  RequestAction,
  TagDto,
  TemplateSummary,
  TemplateType,
  WorkspaceTree,
} from '@swaft/shared';
import { AppError } from '../errors';
import { RepoBase } from './RepoBase';

/** A small, muted palette; a tag's color is picked deterministically from its name. */
const TAG_PALETTE = [
  '#4a6fa5',
  '#4f8a63',
  '#b08442',
  '#8073b0',
  '#b15a5a',
  '#3f8a99',
  '#a05f86',
  '#6f7d52',
];
function pickTagColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[hash % TAG_PALETTE.length]!;
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

interface ProjectRow {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
}
interface FolderRow {
  id: string;
  name: string;
  project_id: string | null;
  parent_folder_id: string | null;
}
interface FolderMetaRow extends FolderRow {
  headers: string;
  proxy: string | null;
  auth: string | null;
  actions: string;
  notes: string;
}

const AUTH_KINDS = new Set(['none', 'inherit', 'bearer', 'basic', 'apikey']);

/** Tolerant JSON parse of a folder's `auth` column (null = inherit from the parent chain). */
function parseFolderAuth(raw: string | null): HttpAuth | null {
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as HttpAuth;
    if (a && typeof a === 'object' && AUTH_KINDS.has(a.kind)) return a;
  } catch {
    /* fall through */
  }
  return null;
}

/** Tolerant JSON parse of a folder's `headers` column (a string→string object). */
function parseFolderHeaders(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v;
      return out;
    }
  } catch {
    /* fall through */
  }
  return {};
}

/** Tolerant JSON parse of a folder's `proxy` column (null = direct connection). */
function parseFolderProxy(raw: string | null): FolderProxyDto | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<FolderProxyDto>;
    if (
      (p.protocol === 'http' || p.protocol === 'https') &&
      typeof p.hostname === 'string' &&
      p.hostname.length > 0 &&
      typeof p.port === 'number'
    ) {
      return { protocol: p.protocol, hostname: p.hostname, port: p.port };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Tolerant JSON parse of a folder's `actions` column (an array of request actions). */
function parseFolderActions(raw: string | null): RequestAction[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RequestAction[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const a = item as Partial<RequestAction>;
      if (typeof a.ref !== 'string' || (a.trigger !== 'pre' && a.trigger !== 'post')) continue;
      const action: RequestAction = { ref: a.ref, trigger: a.trigger };
      if (a.input && typeof a.input === 'object' && !Array.isArray(a.input)) {
        action.input = a.input as Record<string, string>;
      }
      if (typeof a.enabled === 'boolean') action.enabled = a.enabled;
      out.push(action);
    }
    return out;
  } catch {
    return [];
  }
}
interface TagRow {
  id: string;
  name: string;
  color: string | null;
}
interface TemplateRow {
  id: string;
  folder_id: string;
  project_id: string | null;
  name: string;
  type: string;
  subtype: string | null;
  source: string;
}

/**
 * CRUD for the 🟢 synchronized organization entities (projects = filters, folders = collections,
 * tags = labels). Every mutation persists the `.swaft` and returns the fresh tree so the renderer
 * updates in one round-trip. See SWAFT_DATA_MODEL.md §5–§6.
 */
export class OrganizationService extends RepoBase {
  async getTree(): Promise<WorkspaceTree> {
    const projects = await this.adapter.all<ProjectRow>(
      `SELECT id, name, color, description FROM projects WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    );
    const folders = await this.adapter.all<FolderRow>(
      `SELECT id, name, project_id, parent_folder_id FROM folders WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    );
    const tags = await this.adapter.all<TagRow>(
      `SELECT id, name, color FROM tags WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    );
    const templates = await this.adapter.all<TemplateRow>(
      `SELECT id, folder_id, project_id, name, type, subtype, source FROM templates WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    );
    // Template → tag ids, for the Tags grouping view + row badges.
    const tagLinks = await this.adapter.all<{ template_id: string; tag_id: string }>(
      `SELECT tt.template_id, tt.tag_id FROM template_tags tt
       JOIN tags t ON t.id = tt.tag_id
       WHERE tt.deleted_at IS NULL AND t.deleted_at IS NULL`,
    );
    const tagsByTemplate = new Map<string, string[]>();
    for (const l of tagLinks) {
      const list = tagsByTemplate.get(l.template_id) ?? [];
      list.push(l.tag_id);
      tagsByTemplate.set(l.template_id, list);
    }
    return {
      projects: projects.map(
        (p): ProjectDto => ({ id: p.id, name: p.name, color: p.color, description: p.description }),
      ),
      folders: folders.map(
        (f): FolderDto => ({
          id: f.id,
          name: f.name,
          projectId: f.project_id ?? '',
          parentFolderId: f.parent_folder_id,
        }),
      ),
      tags: tags.map((t): TagDto => ({ id: t.id, name: t.name, color: t.color })),
      templates: templates.map(
        (t): TemplateSummary => ({
          id: t.id,
          folderId: t.folder_id ? t.folder_id : null,
          projectId: t.folder_id ? null : (t.project_id ?? null),
          name: t.name,
          type: t.type as TemplateType,
          subtype: t.subtype,
          tagIds: tagsByTemplate.get(t.id) ?? [],
          method: t.type === 'api' ? extractHttpMethod(t.source) : null,
        }),
      ),
    };
  }

  createProject(input: {
    name: string;
    color?: string;
    description?: string;
  }): Promise<WorkspaceTree> {
    const description = input.description?.trim();
    return this.insertAndCommit('projects', {
      id: randomUUID(),
      name: input.name.trim(),
      color: input.color ?? null,
      description: description ? description : null,
    });
  }
  renameProject(id: string, name: string): Promise<WorkspaceTree> {
    return this.updateAndCommit('projects', id, { name: name.trim() });
  }
  /** Deleting a project cascades a soft-delete to its folders and its root-level templates. */
  async deleteProject(id: string): Promise<WorkspaceTree> {
    const folders = await this.adapter.all<{ id: string }>(
      `SELECT id FROM folders WHERE project_id = ? AND deleted_at IS NULL`,
      [id],
    );
    for (const f of folders) await this.softDelete('folders', f.id);
    const rootTemplates = await this.adapter.all<{ id: string }>(
      `SELECT id FROM templates WHERE project_id = ? AND folder_id = '' AND deleted_at IS NULL`,
      [id],
    );
    for (const tpl of rootTemplates) await this.softDelete('templates', tpl.id);
    await this.softDelete('projects', id);
    return this.commit();
  }

  createFolder(input: {
    name: string;
    projectId: string;
    parentFolderId?: string | null;
  }): Promise<WorkspaceTree> {
    return this.insertAndCommit('folders', {
      id: randomUUID(),
      name: input.name.trim(),
      project_id: input.projectId,
      parent_folder_id: input.parentFolderId ?? null,
    });
  }
  renameFolder(id: string, name: string): Promise<WorkspaceTree> {
    return this.updateAndCommit('folders', id, { name: name.trim() });
  }
  /** Soft-delete a folder and everything beneath it (descendant folders + their templates). */
  async deleteFolder(id: string): Promise<WorkspaceTree> {
    const ids = [id, ...(await this.descendantFolderIds(id))];
    for (const folderId of ids) {
      const templates = await this.adapter.all<{ id: string }>(
        `SELECT id FROM templates WHERE folder_id = ? AND deleted_at IS NULL`,
        [folderId],
      );
      for (const tpl of templates) await this.softDelete('templates', tpl.id);
      await this.softDelete('folders', folderId);
    }
    return this.commit();
  }

  /** A folder with its propagated HTTP policy + notes (the Folder view). */
  async getFolder(id: string): Promise<FolderDetailDto> {
    const row = await this.adapter.get<FolderMetaRow>(
      `SELECT id, name, project_id, parent_folder_id, headers, proxy, auth, actions, notes
       FROM folders WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    if (!row) throw new AppError('FOLDER_NOT_FOUND', 'not_found', 'Folder not found.');
    return {
      id: row.id,
      name: row.name,
      projectId: row.project_id ?? '',
      parentFolderId: row.parent_folder_id,
      headers: parseFolderHeaders(row.headers),
      proxy: parseFolderProxy(row.proxy),
      auth: parseFolderAuth(row.auth),
      inheritedAuth: await this.effectiveChainAuth(row.parent_folder_id),
      actions: parseFolderActions(row.actions),
      inheritedActions: await this.chainActions(row.parent_folder_id),
      notes: row.notes ?? '',
    };
  }

  /** Partially update a folder's propagated headers/proxy/auth/actions/notes. */
  async updateFolderMeta(
    id: string,
    patch: {
      headers?: Record<string, string>;
      proxy?: FolderProxyDto | null;
      auth?: HttpAuth | null;
      actions?: RequestAction[];
      notes?: string;
    },
  ): Promise<FolderDetailDto> {
    await this.getFolder(id); // 404 before writing
    const set: Record<string, string | null> = {};
    if (patch.headers !== undefined) set.headers = JSON.stringify(patch.headers);
    if (patch.proxy !== undefined) set.proxy = patch.proxy ? JSON.stringify(patch.proxy) : null;
    if (patch.auth !== undefined) {
      // An explicit `inherit` is the same as unset (null): the chain decides.
      set.auth =
        patch.auth && patch.auth.kind !== 'inherit' ? JSON.stringify(patch.auth) : null;
    }
    if (patch.actions !== undefined) set.actions = JSON.stringify(patch.actions);
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (Object.keys(set).length > 0) {
      await this.updateEntity('folders', id, set);
      await this.ws.save();
    }
    return this.getFolder(id);
  }

  /**
   * The concrete auth a node inherits starting from folder `startId` and walking up: the nearest
   * folder whose `auth` is set (kind `none` is an explicit stop meaning "no auth").
   */
  private async effectiveChainAuth(startId: string | null): Promise<HttpAuth | null> {
    const seen = new Set<string>();
    let cursor = startId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const row = await this.adapter.get<{ parent_folder_id: string | null; auth: string | null }>(
        `SELECT parent_folder_id, auth FROM folders WHERE id = ? AND deleted_at IS NULL`,
        [cursor],
      );
      if (!row) break;
      const auth = parseFolderAuth(row.auth);
      if (auth && auth.kind !== 'inherit') return auth;
      cursor = row.parent_folder_id;
    }
    return null;
  }

  /**
   * The actions a node inherits from its folder chain, starting at `startId` and walking up, in
   * apply order: root-most folder first, nearest last. Unlike headers/auth these are not overridden
   * but *concatenated* — every ancestor's actions run around the call.
   */
  private async chainActions(startId: string | null): Promise<RequestAction[]> {
    const chain: RequestAction[][] = [];
    const seen = new Set<string>();
    let cursor = startId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const row = await this.adapter.get<{ parent_folder_id: string | null; actions: string }>(
        `SELECT parent_folder_id, actions FROM folders WHERE id = ? AND deleted_at IS NULL`,
        [cursor],
      );
      if (!row) break;
      chain.push(parseFolderActions(row.actions));
      cursor = row.parent_folder_id;
    }
    // `chain` is leaf→root; reverse so the outermost folder's actions come first.
    return chain.reverse().flat();
  }

  /**
   * The HTTP policy a template inherits from its folder chain: headers merged root→leaf (a nearer
   * folder overrides an ancestor's same-name header), the nearest configured proxy, the nearest
   * folder-defined auth, and the actions of every folder concatenated root→leaf. Root-level
   * templates (no folder) inherit nothing.
   */
  async folderPolicyOf(templateId: string): Promise<{
    headers: Record<string, string>;
    proxy: FolderProxyDto | null;
    auth: HttpAuth | null;
    actions: RequestAction[];
  }> {
    const tpl = await this.adapter.get<{ folder_id: string }>(
      `SELECT folder_id FROM templates WHERE id = ? AND deleted_at IS NULL`,
      [templateId],
    );
    // Leaf → root chain (cycle-guarded), then folded root → leaf so nearer folders win.
    const chain: {
      parent_folder_id: string | null;
      headers: string;
      proxy: string | null;
      auth: string | null;
      actions: string;
    }[] = [];
    const seen = new Set<string>();
    let cursor = tpl?.folder_id || null;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const row = await this.adapter.get<{
        parent_folder_id: string | null;
        headers: string;
        proxy: string | null;
        auth: string | null;
        actions: string;
      }>(
        `SELECT parent_folder_id, headers, proxy, auth, actions FROM folders WHERE id = ? AND deleted_at IS NULL`,
        [cursor],
      );
      if (!row) break;
      chain.push(row);
      cursor = row.parent_folder_id;
    }
    const headers: Record<string, string> = {};
    let proxy: FolderProxyDto | null = null;
    let auth: HttpAuth | null = null;
    const actions: RequestAction[] = [];
    for (const row of chain.reverse()) {
      Object.assign(headers, parseFolderHeaders(row.headers));
      proxy = parseFolderProxy(row.proxy) ?? proxy;
      const rowAuth = parseFolderAuth(row.auth);
      if (rowAuth && rowAuth.kind !== 'inherit') auth = rowAuth;
      actions.push(...parseFolderActions(row.actions));
    }
    return { headers, proxy, auth, actions };
  }

  /** Move a folder under a new parent (or to the project root when `parentFolderId` is null). */
  async moveFolder(id: string, parentFolderId: string | null): Promise<WorkspaceTree> {
    if (parentFolderId === id) {
      throw new AppError('INVALID_MOVE', 'validation', 'A folder cannot be moved into itself.');
    }
    if (parentFolderId) {
      const descendants = await this.descendantFolderIds(id);
      if (descendants.includes(parentFolderId)) {
        throw new AppError(
          'INVALID_MOVE',
          'validation',
          'A folder cannot be moved into one of its own subfolders.',
        );
      }
      const parent = await this.adapter.get<{ project_id: string | null }>(
        `SELECT project_id FROM folders WHERE id = ? AND deleted_at IS NULL`,
        [parentFolderId],
      );
      if (!parent) throw new AppError('FOLDER_NOT_FOUND', 'not_found', 'Target folder not found.');
      return this.updateAndCommit('folders', id, {
        parent_folder_id: parentFolderId,
        project_id: parent.project_id,
      });
    }
    return this.updateAndCommit('folders', id, { parent_folder_id: null });
  }

  /**
   * Move a template into a folder, or to the project root (`folderId` null, `projectId` set).
   * Root templates carry `folder_id = ''` + their owning `project_id`.
   */
  moveTemplate(
    id: string,
    folderId: string | null,
    projectId?: string,
  ): Promise<WorkspaceTree> {
    if (folderId) return this.updateAndCommit('templates', id, { folder_id: folderId, project_id: null });
    if (!projectId) {
      throw new AppError('INVALID_MOVE', 'validation', 'Moving to the root requires a project.');
    }
    return this.updateAndCommit('templates', id, { folder_id: '', project_id: projectId });
  }

  /** All folder ids nested (transitively) under `id`. */
  private async descendantFolderIds(id: string): Promise<string[]> {
    const out: string[] = [];
    let frontier = [id];
    while (frontier.length > 0) {
      const placeholders = frontier.map(() => '?').join(',');
      const children = await this.adapter.all<{ id: string }>(
        `SELECT id FROM folders WHERE parent_folder_id IN (${placeholders}) AND deleted_at IS NULL`,
        frontier,
      );
      frontier = children.map((c) => c.id);
      out.push(...frontier);
    }
    return out;
  }

  createTag(input: { name: string; color?: string }): Promise<WorkspaceTree> {
    return this.insertAndCommit('tags', {
      id: randomUUID(),
      name: input.name.trim(),
      color: input.color ?? null,
    });
  }
  deleteTag(id: string): Promise<WorkspaceTree> {
    return this.deleteAndCommit('tags', id);
  }

  /** All reusable workspace tags (for assigning/autocompleting on templates). */
  async listTags(): Promise<TagDto[]> {
    const rows = await this.adapter.all<TagRow>(
      `SELECT id, name, color FROM tags WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    );
    return rows.map((t) => ({ id: t.id, name: t.name, color: t.color }));
  }

  /** The tags assigned to a template. */
  async listTemplateTags(templateId: string): Promise<TagDto[]> {
    const rows = await this.adapter.all<TagRow>(
      `SELECT t.id, t.name, t.color FROM template_tags tt
       JOIN tags t ON t.id = tt.tag_id
       WHERE tt.template_id = ? AND tt.deleted_at IS NULL AND t.deleted_at IS NULL
       ORDER BY t.name COLLATE NOCASE`,
      [templateId],
    );
    return rows.map((t) => ({ id: t.id, name: t.name, color: t.color }));
  }

  /** Assign a tag (by name) to a template, creating the reusable tag if it is new. */
  async addTemplateTag(templateId: string, name: string): Promise<TagDto[]> {
    const tag = await this.ensureTag(name);
    const existing = await this.adapter.get<{ id: string }>(
      `SELECT id FROM template_tags WHERE template_id = ? AND tag_id = ? AND deleted_at IS NULL`,
      [templateId, tag.id],
    );
    if (!existing) {
      await this.insertEntity('template_tags', {
        id: randomUUID(),
        template_id: templateId,
        tag_id: tag.id,
      });
    }
    await this.ws.save();
    return this.listTemplateTags(templateId);
  }

  async removeTemplateTag(templateId: string, tagId: string): Promise<TagDto[]> {
    const row = await this.adapter.get<{ id: string }>(
      `SELECT id FROM template_tags WHERE template_id = ? AND tag_id = ? AND deleted_at IS NULL`,
      [templateId, tagId],
    );
    if (row) await this.softDelete('template_tags', row.id);
    await this.ws.save();
    return this.listTemplateTags(templateId);
  }

  /** Find a tag by name (case-insensitive) or create it with a deterministic palette color. */
  private async ensureTag(name: string): Promise<TagDto> {
    const trimmed = name.trim();
    const found = await this.adapter.get<TagRow>(
      `SELECT id, name, color FROM tags WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL`,
      [trimmed],
    );
    if (found) return { id: found.id, name: found.name, color: found.color };
    const tag: TagDto = { id: randomUUID(), name: trimmed, color: pickTagColor(trimmed) };
    await this.insertEntity('tags', { id: tag.id, name: tag.name, color: tag.color });
    return tag;
  }

  private async insertAndCommit(
    table: string,
    domain: Record<string, string | null>,
  ): Promise<WorkspaceTree> {
    await this.insertEntity(table, domain);
    return this.commit();
  }
  private async updateAndCommit(
    table: string,
    id: string,
    set: Record<string, string | null>,
  ): Promise<WorkspaceTree> {
    await this.updateEntity(table, id, set);
    return this.commit();
  }
  private async deleteAndCommit(table: string, id: string): Promise<WorkspaceTree> {
    await this.softDelete(table, id);
    return this.commit();
  }
  private async commit(): Promise<WorkspaceTree> {
    await this.ws.save();
    return this.getTree();
  }
}
