import { randomUUID } from 'node:crypto';
import type { ImportedCollection } from '@swaft/shared';
import type { EnvironmentService } from './EnvironmentService';
import type { OrganizationService } from './OrganizationService';
import type { TemplateService } from './TemplateService';

/**
 * Materializes a neutral {@link ImportedCollection} (from the OpenAPI/Postman/Bruno adapters) into
 * real workspace entities — projects, folders and `api` templates — plus optional environments
 * (open-standards plan §6.3). Import is mostly **additive** (it creates), except when a request
 * carries a `swaftId` (Bruno round-trip identity, open-standards §3.7) that still names a live
 * template in this workspace — that template's source is updated in place instead of duplicated.
 * The target can be an existing project/folder or a freshly-created project.
 *
 * Each request becomes an `api` template whose `source` is the JSON request model (exactly how the
 * API view stores one today), so nothing downstream changes — the `.http` on-disk form is a separate,
 * projection-level concern.
 */

export type ImportTarget =
  | { kind: 'new-project'; name?: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'folder'; projectId: string; folderId: string };

export interface ImportResult {
  projectId: string;
  folders: number;
  requests: number;
  /** Existing templates matched by `swaftId` and updated in place, not counted in `requests` (§3.7). */
  updated: number;
  environments: number;
}

/** A safe entity name (non-empty, within the 120-char limit the schema enforces). */
function safeName(name: string, fallback: string): string {
  const t = name.trim();
  return (t === '' ? fallback : t).slice(0, 120);
}

export class ImportService {
  constructor(
    private readonly deps: {
      organization: OrganizationService;
      templates: TemplateService;
      environments: EnvironmentService;
    },
  ) {}

  async importCollection(col: ImportedCollection, target: ImportTarget): Promise<ImportResult> {
    const { organization, templates, environments } = this.deps;

    let projectId: string;
    let rootFolderId: string | null = null;
    if (target.kind === 'new-project') {
      projectId = randomUUID();
      await organization.createProject({ id: projectId, name: safeName(target.name ?? col.name, 'Imported') });
    } else {
      projectId = target.projectId;
      if (target.kind === 'folder') rootFolderId = target.folderId;
    }

    // Create each folder path once, reusing already-created segments across requests.
    let folders = 0;
    const cache = new Map<string, string | null>();
    const ensureFolder = async (path: string[]): Promise<string | null> => {
      let parent = rootFolderId;
      const acc: string[] = [];
      for (const seg of path) {
        acc.push(seg);
        const key = acc.join('\0');
        let id = cache.get(key);
        if (id === undefined) {
          id = randomUUID();
          await organization.createFolder({
            id,
            name: safeName(seg, 'Folder'),
            projectId,
            parentFolderId: parent,
          });
          cache.set(key, id);
          folders++;
        }
        parent = id;
      }
      return parent;
    };

    let requests = 0;
    let updated = 0;
    for (const req of col.requests) {
      // §3.7: a Bruno re-import carrying a swaftId that still names a live `api` template updates it
      // in place instead of creating a duplicate; any other id (foreign, stale, deleted, or naming a
      // non-api template — a hand-edited/crafted .bru could claim any id) falls through to a normal
      // create, never reused for a different or wrong-typed entity.
      const existing = req.swaftId ? await templates.getTemplate(req.swaftId) : null;
      if (existing && existing.type === 'api') {
        await templates.updateSource(existing.id, JSON.stringify(req.request, null, 2));
        updated++;
        continue;
      }
      const folderId = await ensureFolder(req.folderPath);
      await templates.createTemplate({
        id: randomUUID(),
        name: safeName(req.name, 'Request'),
        type: 'api',
        subtype: 'json',
        source: JSON.stringify(req.request, null, 2),
        ...(folderId ? { folderId } : { projectId }),
      });
      requests++;
    }

    let envs = 0;
    for (const env of col.environments) {
      if (Object.keys(env.vars).length === 0) continue;
      const created = await environments.create({
        name: safeName(env.name, 'Imported'),
        ownerKind: 'workspace',
      });
      await environments.update(created.id, { vars: env.vars });
      envs++;
    }

    return { projectId, folders, requests, updated, environments: envs };
  }
}
