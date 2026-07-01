import type { RenderResultDto, RequirementDto } from '@swaft/shared';
import { AppError } from '../errors';
import { toRenderResult, toRequirementDto } from '../seebo/map';
import type { RenderPolicy, SeeboHost } from '../seebo/SeeboHost';
import type { ReleaseService } from './ReleaseService';
import type { SettingsService } from './SettingsService';
import type { TemplateService } from './TemplateService';

/**
 * Batcher (M10): compose **document templates only**, in order, into one rendered output via Seebo's
 * ABSORB merge macro. Shared input ids are resolved **once** (the engine dedupes requirements by id),
 * so the same value flows into every sub-template that needs it. Each sub-template uses its own
 * **effective** source (selected release / draft). See SWAFT_ARCHITECTURE §8.3.
 */
export class BatcherService {
  constructor(
    private readonly templates: TemplateService,
    private readonly releases: ReleaseService,
    private readonly settings: SettingsService,
    private readonly host: SeeboHost,
  ) {}

  private async policy(): Promise<RenderPolicy> {
    const s = await this.settings.getSettings();
    return { allowedCapabilities: s.allowedCapabilities, allowedTypes: s.allowedTypes };
  }

  /** Resolve each id to its effective source, rejecting non-document templates (fail-closed). */
  private async sources(templateIds: string[]): Promise<string[]> {
    if (templateIds.length === 0) {
      throw new AppError('BATCH_EMPTY', 'validation', 'Select at least one document template.');
    }
    const out: string[] = [];
    for (const id of templateIds) {
      const tpl = await this.templates.requireTemplate(id);
      if (tpl.type !== 'document') {
        throw new AppError(
          'BATCH_DOCUMENT_ONLY',
          'policy',
          'The Batcher accepts only document templates.',
        );
      }
      out.push((await this.releases.resolveSource(id)).source);
    }
    return out;
  }

  /** The union of widget requirements across the batch (deduped by id — shared inputs once). */
  async analyze(templateIds: string[]): Promise<RequirementDto[]> {
    const sources = await this.sources(templateIds);
    const policy = await this.policy();
    const seen = new Map<string, RequirementDto>();
    for (const source of sources) {
      const analysis = await this.host.analyze(source, policy);
      for (const req of analysis.requirements) {
        const dto = toRequirementDto(req);
        if (!seen.has(dto.id)) seen.set(dto.id, dto);
      }
    }
    return [...seen.values()];
  }

  /** Render the ordered batch as one composite document, sharing the provided input values. */
  async render(templateIds: string[], values: Record<string, unknown>): Promise<RenderResultDto> {
    const sources = await this.sources(templateIds);
    const template = sources.map((_, i) => `@{ABSORB('t${i}')}`).join('\n');
    const templatesMap = Object.fromEntries(sources.map((s, i) => [`t${i}`, s]));
    const state = await this.host.renderComposite(template, templatesMap, values, await this.policy());
    return toRenderResult(state);
  }
}
