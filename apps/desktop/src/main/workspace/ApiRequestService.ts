import { DATA_CAPABILITIES, type DiagnosticDto, type HttpRequestModel, type RequirementDto } from '@swaft/shared';
import { AppError } from '../errors';
import { toDiagnosticDto, toRequirementDto } from '../seebo/map';
import type { RenderPolicy, SeeboHost, SeeboRenderContext } from '../seebo/SeeboHost';
import type { SettingsService } from './SettingsService';
import type { TemplateService } from './TemplateService';

const DATA_CAPABILITY_SET: ReadonlySet<string> = new Set(DATA_CAPABILITIES);

/** A Seebo slot opener (`${`, `#{`, `@{`); only strings containing one are run through the engine. */
function hasFormula(s: string): boolean {
  return /[$#@]\{/.test(s);
}

/** Decision 6: request fields are pure renders — declaring an effect (`action(...)`) is rejected. */
const ACTIONS_NOT_ALLOWED: DiagnosticDto = {
  code: 'ACTIONS_NOT_ALLOWED',
  message: 'Actions are not allowed in API request fields.',
  position: null,
};

export interface ApiAnalysis {
  /** Input widgets the request needs (data capabilities like `template` are auto-resolved, excluded). */
  requirements: RequirementDto[];
  diagnostics: DiagnosticDto[];
}

/**
 * Renders the Seebo formulas inside an API request's fields (url, header/query values, body) so the
 * request becomes "live": `${ … }` may pull user inputs (surfaced as widgets, like the Document view)
 * and the `template(...)` data capability. The engine resolution shares one `values` map across fields,
 * so the same `id` is one variable. Effects are forbidden in fields; the HTTP call itself stays the
 * only effect (executed by {@link HttpService}). See the API-view automation spec (Fase 1).
 */
export class ApiRequestService {
  constructor(
    private readonly templates: TemplateService,
    private readonly settings: SettingsService,
    private readonly host: SeeboHost,
  ) {}

  private async policy(): Promise<RenderPolicy> {
    const s = await this.settings.getSettings();
    return { allowedCapabilities: s.allowedCapabilities, allowedTypes: s.allowedTypes };
  }

  private async ctx(templateId: string): Promise<SeeboRenderContext> {
    return { projectId: await this.templates.projectIdOf(templateId), templateId };
  }

  /** The formula-bearing field sources of a request, in resolution order. */
  private static sources(req: HttpRequestModel): string[] {
    return [
      req.url,
      ...Object.values(req.headers ?? {}),
      ...Object.values(req.query ?? {}),
      ...(req.body ? [req.body] : []),
    ];
  }

  /**
   * The input requirements the request actually needs for the given `values`, unioned across its
   * formula fields, plus static diagnostics. Seebo collects `need(...)` **lazily**, so a field render
   * with the current values tells us which inputs are truly reached (`pending` ∪ `resolved`) — inputs
   * gated behind an untaken branch are excluded, and progressive reveal works as conditions resolve.
   */
  async analyze(
    templateId: string,
    req: HttpRequestModel,
    values: Record<string, unknown> = {},
  ): Promise<ApiAnalysis> {
    const policy = await this.policy();
    const ctx = await this.ctx(templateId);
    const byId = new Map<string, RequirementDto>(); // the static universe of input requirements
    const pendingById = new Map<string, RequirementDto>(); // render-resolved (dynamic options/candidates)
    const reached = new Set<string>();
    const diagnostics: DiagnosticDto[] = [];
    for (const src of ApiRequestService.sources(req)) {
      if (!hasFormula(src)) continue;
      const analysis = await this.host.analyze(src, policy, ctx);
      if (analysis.actions && analysis.actions.length > 0) diagnostics.push(ACTIONS_NOT_ALLOWED);
      for (const r of analysis.requirements) {
        const dto = toRequirementDto(r);
        // Data capabilities (e.g. `template`) resolve to a value — they are not user inputs.
        if (DATA_CAPABILITY_SET.has(dto.capability)) continue;
        byId.set(dto.id, dto);
      }
      for (const d of await this.host.validate(src, policy)) diagnostics.push(toDiagnosticDto(d));
      // Reachability: render the field with the current values. The render resolves dynamic options
      // (a capability's `args.candidates`), so its `pending` requirements are preferred for the panel.
      const state = await this.host.render(src, values, policy, ctx);
      if (state.status === 'failed') {
        // Conservative on a broken field: keep its inputs visible so they can be fixed.
        for (const r of analysis.requirements) reached.add(String(r.id));
      } else {
        for (const p of state.pending ?? []) {
          const dto = toRequirementDto(p);
          if (!DATA_CAPABILITY_SET.has(dto.capability)) pendingById.set(dto.id, dto);
          reached.add(dto.id);
        }
        if (state.resolved) for (const k of Object.keys(state.resolved)) reached.add(k);
      }
    }
    const requirements = [...byId.values()]
      .filter((r) => reached.has(r.id))
      .map((r) => pendingById.get(r.id) ?? r);
    return { requirements, diagnostics };
  }

  /**
   * Resolve every formula field with `values`, returning a concrete request ready for the HTTP client
   * plus `rendered` (true when any field carried a `${ … }` formula — i.e. needs/capabilities were
   * resolved). Throws `INPUT_REQUIRED` when an input is still unfilled, or `REQUEST_RESOLVE_FAILED` on a
   * diagnostic (syntax error, unknown capability, `action(...)`, or a failed `template(...)` lookup).
   */
  async resolve(
    templateId: string,
    req: HttpRequestModel,
    values: Record<string, unknown>,
  ): Promise<{ request: HttpRequestModel; rendered: boolean }> {
    const policy = await this.policy();
    const ctx = await this.ctx(templateId);
    const rendered = ApiRequestService.sources(req).some(hasFormula);
    const pending = new Map<string, RequirementDto>();
    const diagnostics: DiagnosticDto[] = [];

    const render = async (src: string): Promise<string> => {
      if (!hasFormula(src)) return src;
      const state = await this.host.render(src, values, policy, ctx);
      if (state.actions && state.actions.length > 0) diagnostics.push(ACTIONS_NOT_ALLOWED);
      if (state.status === 'waiting') {
        for (const r of state.pending ?? []) {
          const dto = toRequirementDto(r);
          if (!DATA_CAPABILITY_SET.has(dto.capability)) pending.set(dto.id, dto);
        }
        return '';
      }
      if (state.status === 'failed') {
        for (const d of state.diagnostics ?? []) diagnostics.push(toDiagnosticDto(d));
        return '';
      }
      return state.output ?? '';
    };

    const url = await render(req.url);
    const headers = await mapValues(req.headers, render);
    const query = await mapValues(req.query, render);
    const body = req.body != null ? await render(req.body) : req.body;

    if (diagnostics.length > 0) {
      throw new AppError('REQUEST_RESOLVE_FAILED', 'validation', diagnostics[0]!.message, {
        diagnostics,
      });
    }
    if (pending.size > 0) {
      throw new AppError('INPUT_REQUIRED', 'validation', 'Fill the required inputs before sending.', {
        pending: [...pending.values()],
      });
    }
    return { request: { ...req, url, headers, query, body }, rendered };
  }
}

/** Render every value of a record (keys unchanged), preserving an absent record as undefined. */
async function mapValues(
  rec: Record<string, string> | undefined,
  render: (s: string) => Promise<string>,
): Promise<Record<string, string> | undefined> {
  if (!rec) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = await render(v);
  return out;
}
