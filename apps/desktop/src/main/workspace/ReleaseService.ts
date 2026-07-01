import { randomUUID } from 'node:crypto';
import { DRAFT_RELEASE, type ReleaseDto } from '@swaft/shared';
import { AppError } from '../errors';
import { RepoBase } from './RepoBase';
import type { ChangelogService } from './ChangelogService';
import type { TemplateService } from './TemplateService';
import type { WorkspaceService } from './WorkspaceService';

interface ReleaseRow {
  id: string;
  template_id: string;
  name: string;
  source: string;
  subtype: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Named, **in-place editable** releases (snapshots of a template's draft) + the per-template,
 * personal, local-only release selection (🔵). A release is created from the current draft under a
 * user-chosen name and can later be overwritten via {@link updateRelease}. The effective rendered
 * source resolves: explicit selection → that release/draft; else latest release; else the draft.
 * `version` is an internal, stable ordering key only. See SWAFT_DATA_MODEL.md §7–§9.
 */
export class ReleaseService extends RepoBase {
  constructor(
    ws: WorkspaceService,
    private readonly templates: TemplateService,
    private readonly changelog: ChangelogService,
  ) {
    super(ws);
  }

  async createRelease(
    templateId: string,
    name: string,
    snapshot?: { source?: string; subtype?: string | null },
  ): Promise<ReleaseDto[]> {
    const tpl = await this.templates.requireTemplate(templateId);
    const max = await this.adapter.get<{ v: number | null }>(
      `SELECT MAX(version) AS v FROM releases WHERE template_id = ? AND deleted_at IS NULL`,
      [templateId],
    );
    const version = (max?.v ?? 0) + 1;
    await this.insertEntity('releases', {
      id: randomUUID(),
      template_id: templateId,
      version,
      name: name.trim(),
      source: snapshot?.source ?? tpl.source,
      subtype: snapshot?.subtype !== undefined ? snapshot.subtype : tpl.subtype,
    });
    await this.changelog.addEntry('template', templateId, `Release "${name.trim()}" created`);
    await this.ws.save();
    return this.listReleases(templateId);
  }

  /** Overwrite a release's source/subtype in place (releases are editable). */
  async updateRelease(
    releaseId: string,
    patch: { source: string; subtype?: string | null },
  ): Promise<ReleaseDto[]> {
    const row = await this.adapter.get<{ template_id: string; name: string }>(
      `SELECT template_id, name FROM releases WHERE id = ? AND deleted_at IS NULL`,
      [releaseId],
    );
    if (!row) throw new AppError('RELEASE_NOT_FOUND', 'not_found', 'Release not found.');
    await this.updateEntity('releases', releaseId, {
      source: patch.source,
      subtype: patch.subtype ?? null,
    });
    await this.changelog.addEntry('template', row.template_id, `Release "${row.name}" updated`);
    await this.ws.save();
    return this.listReleases(row.template_id);
  }

  /** Soft-delete a release; logs the change. A template must keep ≥1 version (draft or release). */
  async deleteRelease(releaseId: string): Promise<ReleaseDto[]> {
    const row = await this.adapter.get<{ template_id: string; name: string }>(
      `SELECT template_id, name FROM releases WHERE id = ? AND deleted_at IS NULL`,
      [releaseId],
    );
    if (!row) throw new AppError('RELEASE_NOT_FOUND', 'not_found', 'Release not found.');
    await this.assertNotLastVersion(row.template_id);
    await this.softDelete('releases', releaseId);
    await this.changelog.addEntry('template', row.template_id, `Release "${row.name}" deleted`);
    await this.ws.save();
    return this.listReleases(row.template_id);
  }

  /** Delete the editable Draft version (leaving only releases). Errors if it is the last version. */
  async deleteDraft(templateId: string): Promise<void> {
    const tpl = await this.templates.requireTemplate(templateId);
    if (!tpl.hasDraft) return;
    await this.assertNotLastVersion(templateId);
    await this.updateEntity('templates', templateId, { has_draft: 0 });
    // Move the selection off the (now gone) draft, to the latest release.
    const raw = await this.rawSelection(templateId);
    if (!raw || raw === DRAFT_RELEASE) {
      const latest = (await this.listReleases(templateId))[0];
      if (latest) {
        await this.adapter.run(
          `INSERT OR REPLACE INTO release_selection (template_id, release_id, updated_at) VALUES (?, ?, ?)`,
          [templateId, latest.id, this.ws.nowIso()],
        );
      }
    }
    await this.changelog.addEntry('template', templateId, 'Draft deleted');
    await this.ws.save();
  }

  /** Throws when the template has only one version left (draft + releases). */
  private async assertNotLastVersion(templateId: string): Promise<void> {
    const tpl = await this.templates.requireTemplate(templateId);
    const versions = (tpl.hasDraft ? 1 : 0) + (await this.listReleases(templateId)).length;
    if (versions <= 1) {
      throw new AppError(
        'LAST_VERSION',
        'policy',
        'A template must keep at least one version (draft or release).',
      );
    }
  }

  async listReleases(templateId: string): Promise<ReleaseDto[]> {
    const rows = await this.adapter.all<ReleaseRow>(
      `SELECT id, template_id, name, source, subtype, created_at, updated_at FROM releases
       WHERE template_id = ? AND deleted_at IS NULL ORDER BY version DESC`,
      [templateId],
    );
    return rows.map((r) => ({
      id: r.id,
      templateId: r.template_id,
      name: r.name,
      source: r.source,
      subtype: r.subtype,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /** The effective selection id (a release id or `draft`), applying the latest→draft fallback. */
  async getSelection(templateId: string): Promise<string> {
    const raw = await this.rawSelection(templateId);
    if (raw) return raw;
    const latest = await this.adapter.get<{ id: string }>(
      `SELECT id FROM releases WHERE template_id = ? AND deleted_at IS NULL ORDER BY version DESC LIMIT 1`,
      [templateId],
    );
    return latest ? latest.id : DRAFT_RELEASE;
  }

  async setSelection(templateId: string, releaseId: string): Promise<string> {
    await this.adapter.run(
      `INSERT OR REPLACE INTO release_selection (template_id, release_id, updated_at) VALUES (?, ?, ?)`,
      [templateId, releaseId, this.ws.nowIso()],
    );
    await this.ws.save();
    return releaseId;
  }

  /** Effective source (+subtype) the renderer should use for a template. */
  async resolveSource(templateId: string): Promise<{ source: string; subtype: string | null }> {
    const tpl = await this.templates.requireTemplate(templateId);
    let selection = await this.getSelection(templateId);
    // The draft may have been deleted while still selected → fall back to the latest release.
    if (selection === DRAFT_RELEASE && !tpl.hasDraft) {
      const latest = (await this.listReleases(templateId))[0];
      selection = latest ? latest.id : DRAFT_RELEASE;
    }
    if (selection === DRAFT_RELEASE) return { source: tpl.source, subtype: tpl.subtype };
    const release = await this.adapter.get<{ source: string; subtype: string | null }>(
      `SELECT source, subtype FROM releases WHERE id = ? AND deleted_at IS NULL`,
      [selection],
    );
    return release
      ? { source: release.source, subtype: release.subtype }
      : { source: tpl.source, subtype: tpl.subtype };
  }

  private async rawSelection(templateId: string): Promise<string | null> {
    const row = await this.adapter.get<{ release_id: string }>(
      `SELECT release_id FROM release_selection WHERE template_id = ?`,
      [templateId],
    );
    return row?.release_id ?? null;
  }
}
