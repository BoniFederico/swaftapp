import { AppError } from '../errors';
import type { TemplateDataProvider as ITemplateDataProvider } from '../seebo/SeeboHost';
import { RepoBase } from './RepoBase';
import type { ReleaseService } from './ReleaseService';
import type { WorkspaceService } from './WorkspaceService';

interface MatchRow {
  id: string;
  /** The owning project: the template's own `project_id` (root) or its folder's. */
  proj: string | null;
}

/**
 * Resolves the `template(...)` Seebo data capability: the content of another `json` template in the
 * **same project**, read as a plain JSON object. The referenced template is never rendered by Seebo —
 * its **effective source** (selected release / draft, via {@link ReleaseService.resolveSource}) is
 * parsed as raw JSON. This keeps the capability formula-free (no recursion, no nested inputs) and
 * makes the referenced data reproducible.
 */
export class TemplateDataProvider extends RepoBase implements ITemplateDataProvider {
  constructor(
    ws: WorkspaceService,
    private readonly releases: ReleaseService,
  ) {
    super(ws);
  }

  async resolve(ref: string, projectId: string | null): Promise<unknown> {
    const name = ref.trim();
    if (!name) {
      throw new AppError('TEMPLATE_REF_REQUIRED', 'validation', 'template(...) requires a template name.');
    }
    // A template's project is its folder's project (when foldered) or its own project_id (at root).
    const rows = await this.adapter.all<MatchRow>(
      `SELECT t.id AS id,
              CASE WHEN t.folder_id IS NULL OR t.folder_id = '' THEN t.project_id ELSE f.project_id END AS proj
         FROM templates t
         LEFT JOIN folders f ON f.id = t.folder_id AND f.deleted_at IS NULL
        WHERE t.deleted_at IS NULL AND t.subtype = 'json' AND t.name = ? COLLATE NOCASE`,
      [name],
    );
    const matches = rows.filter((r) => (r.proj ?? null) === (projectId ?? null));
    if (matches.length === 0) {
      throw new AppError(
        'TEMPLATE_NOT_FOUND',
        'not_found',
        `No json template named "${name}" in this project.`,
      );
    }
    if (matches.length > 1) {
      throw new AppError(
        'TEMPLATE_AMBIGUOUS',
        'validation',
        `Multiple json templates named "${name}" in this project — rename to disambiguate.`,
      );
    }
    const { source } = await this.releases.resolveSource(matches[0]!.id);
    try {
      return JSON.parse(source) as unknown;
    } catch {
      throw new AppError(
        'TEMPLATE_NOT_JSON',
        'validation',
        `Template "${name}" is not valid JSON (the template(...) capability requires formula-free JSON).`,
      );
    }
  }
}
