import type { DiagnosticDto, RenderResultDto, RequirementDto } from '@swaft/shared';
import { toDiagnosticDto, toRenderResult, toRequirementDto } from '../seebo/map';
import type { SeeboHost, SeeboRenderContext } from '../seebo/SeeboHost';
import type { SeeboRequirement } from '../seebo/seebo-module';
import { RepoBase } from './RepoBase';
import type { ReleaseService } from './ReleaseService';
import type { TemplateService } from './TemplateService';
import type { WorkspaceService } from './WorkspaceService';

/**
 * Drives the Seebo engine for a template: surfaces input requirements (widgets) and renders output
 * with the host-provided values. The render policy (allowed capabilities/types) comes from workspace
 * settings. Last input values are persisted **local-only** (🔵) per template. See SWAFT_ARCHITECTURE
 * §8–§8.2.1.
 */
export class RenderService extends RepoBase {
  constructor(
    ws: WorkspaceService,
    private readonly templates: TemplateService,
    private readonly host: SeeboHost,
    private readonly releases: ReleaseService,
  ) {
    super(ws);
  }


  /** Render context so data capabilities (e.g. `template`) can scope their lookups to the project. */
  private async renderCtx(templateId: string): Promise<SeeboRenderContext> {
    return { projectId: await this.templates.projectIdOf(templateId), templateId };
  }

  /**
   * The widget requirements for the template's **effective** source (selected release / draft).
   * Data capabilities — `template`, `env` and every user-authored one — resolve to a value, so they
   * are filtered out here rather than in the renderer, which cannot know the user-authored names.
   */
  async analyze(templateId: string): Promise<RequirementDto[]> {
    const { source } = await this.releases.resolveSource(templateId);
    const ctx = await this.renderCtx(templateId);
    return this.inputRequirements((await this.host.analyze(source, undefined, ctx)).requirements);
  }

  private async inputRequirements(requirements: SeeboRequirement[]): Promise<RequirementDto[]> {
    const data = await this.host.dataCapabilityNames();
    return requirements.map(toRequirementDto).filter((r) => !data.has(r.capability));
  }

  /** Render the template's effective source with the provided values; persists them as last inputs. */
  async render(templateId: string, values: Record<string, unknown>): Promise<RenderResultDto> {
    await this.templates.requireTemplate(templateId);
    await this.setInputState(templateId, values);
    const { source } = await this.releases.resolveSource(templateId);
    const ctx = await this.renderCtx(templateId);
    const state = await this.host.render(source, values, undefined, ctx);
    return toRenderResult(state);
  }

  /** Analyze arbitrary source (Template Editor live feedback). */
  async analyzeSource(source: string): Promise<RequirementDto[]> {
    return this.inputRequirements((await this.host.analyze(source)).requirements);
  }

  /** Render arbitrary (possibly unsaved) source — the Template Editor's view/render preview. */
  async renderSource(source: string, values: Record<string, unknown>): Promise<RenderResultDto> {
    return toRenderResult(await this.host.render(source, values));
  }

  /** Static diagnostics for arbitrary source (Template Editor live feedback). */
  async validateSource(source: string): Promise<DiagnosticDto[]> {
    return (await this.host.validate(source)).map(toDiagnosticDto);
  }

  async getInputState(templateId: string): Promise<Record<string, unknown>> {
    const row = await this.adapter.get<{ values_json: string }>(
      `SELECT values_json FROM local_input_state WHERE template_id = ?`,
      [templateId],
    );
    if (!row) return {};
    try {
      const parsed: unknown = JSON.parse(row.values_json);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  async setInputState(
    templateId: string,
    values: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    await this.adapter.run(
      `INSERT OR REPLACE INTO local_input_state (template_id, values_json, updated_at) VALUES (?, ?, ?)`,
      [templateId, JSON.stringify(values), this.ws.nowIso()],
    );
    await this.ws.save();
    return values;
  }
}
