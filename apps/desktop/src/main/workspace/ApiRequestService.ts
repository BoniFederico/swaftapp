import type {
  DiagnosticDto,
  FolderProxyDto,
  HttpAuth,
  HttpRequestModel,
  RequirementDto,
} from '@swaft/shared';
import { AppError } from '../errors';
import { toDiagnosticDto, toRequirementDto } from '../seebo/map';
import type { SeeboHost, SeeboRenderContext } from '../seebo/SeeboHost';
import type { TemplateService } from './TemplateService';

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

/** The HTTP policy a template inherits from its folder chain (see OrganizationService). */
export interface FolderPolicyProvider {
  folderPolicyOf(templateId: string): Promise<{
    headers: Record<string, string>;
    proxy: FolderProxyDto | null;
    auth: HttpAuth | null;
  }>;
}

/** The formula-bearing string fields of an auth (rendered like header values). */
function authSources(auth: HttpAuth | null | undefined): string[] {
  if (!auth) return [];
  return [auth.username, auth.password, auth.token, auth.key, auth.value].filter(
    (s): s is string => typeof s === 'string',
  );
}

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
    private readonly host: SeeboHost,
    private readonly folders?: FolderPolicyProvider,
  ) {}

  private async policyOf(templateId: string) {
    return (
      (await this.folders?.folderPolicyOf(templateId)) ?? {
        headers: {} as Record<string, string>,
        proxy: null,
        auth: null,
      }
    );
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
    const ctx = await this.ctx(templateId);
    // Folder-propagated header values, the proxy hostname and the effective auth fields are rendered
    // alongside the request's own fields, so any inputs they `need(...)` surface as widgets too.
    const policy = await this.policyOf(templateId);
    const effectiveAuth = req.auth?.kind === 'inherit' ? policy.auth : req.auth;
    const folderHeaderValues = [
      ...Object.values(policy.headers),
      ...(policy.proxy ? [policy.proxy.hostname] : []),
      ...authSources(effectiveAuth),
    ];
    // Built-in data capabilities plus the user-authored ones: all resolve to a value, none is input.
    const dataCapabilities = await this.host.dataCapabilityNames();
    const byId = new Map<string, RequirementDto>(); // the static universe of input requirements
    const pendingById = new Map<string, RequirementDto>(); // render-resolved (dynamic options/candidates)
    const reached = new Set<string>();
    const diagnostics: DiagnosticDto[] = [];
    for (const src of [...ApiRequestService.sources(req), ...folderHeaderValues]) {
      if (!hasFormula(src)) continue;
      const analysis = await this.host.analyze(src, undefined, ctx);
      if (analysis.actions && analysis.actions.length > 0) diagnostics.push(ACTIONS_NOT_ALLOWED);
      for (const r of analysis.requirements) {
        const dto = toRequirementDto(r);
        // Data capabilities (e.g. `template`) resolve to a value — they are not user inputs.
        if (dataCapabilities.has(dto.capability)) continue;
        byId.set(dto.id, dto);
      }
      for (const d of await this.host.validate(src)) diagnostics.push(toDiagnosticDto(d));
      // Reachability: render the field with the current values. The render resolves dynamic options
      // (a capability's `args.candidates`), so its `pending` requirements are preferred for the panel.
      const state = await this.host.render(src, values, undefined, ctx);
      if (state.status === 'failed') {
        // Conservative on a broken field: keep its inputs visible so they can be fixed.
        for (const r of analysis.requirements) reached.add(String(r.id));
      } else {
        for (const p of state.pending ?? []) {
          const dto = toRequirementDto(p);
          if (!dataCapabilities.has(dto.capability)) pendingById.set(dto.id, dto);
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
  ): Promise<{ request: HttpRequestModel; rendered: boolean; proxy: FolderProxyDto | null }> {
    const ctx = await this.ctx(templateId);
    const policy = await this.policyOf(templateId);
    const dataCapabilities = await this.host.dataCapabilityNames();
    const rendered =
      ApiRequestService.sources(req).some(hasFormula) || Object.keys(policy.headers).length > 0;
    const pending = new Map<string, RequirementDto>();
    const diagnostics: DiagnosticDto[] = [];

    const render = async (src: string): Promise<string> => {
      if (!hasFormula(src)) return src;
      const state = await this.host.render(src, values, undefined, ctx);
      if (state.actions && state.actions.length > 0) diagnostics.push(ACTIONS_NOT_ALLOWED);
      if (state.status === 'waiting') {
        for (const r of state.pending ?? []) {
          const dto = toRequirementDto(r);
          if (!dataCapabilities.has(dto.capability)) pending.set(dto.id, dto);
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
    // Folder-propagated headers are rendered too (they may carry formulas) and merged as defaults:
    // the request's own header of the same name wins; workspace enforced headers still win over all.
    const folderHeaders = await mapValues(policy.headers, render);
    const ownHeaders = await mapValues(req.headers, render);
    const headers =
      folderHeaders && Object.keys(folderHeaders).length > 0
        ? { ...folderHeaders, ...(ownHeaders ?? {}) }
        : ownHeaders;
    const query = await mapValues(req.query, render);
    const body = req.body != null ? await render(req.body) : req.body;
    // The proxy hostname may carry formulas too (e.g. `${ env('proxy_host') }`) — rendered before the
    // pending/diagnostic checks so its unfilled inputs also surface as INPUT_REQUIRED.
    const proxy = policy.proxy
      ? { ...policy.proxy, hostname: await render(policy.proxy.hostname) }
      : null;
    // Auth: `inherit` resolves to the nearest folder-defined auth; its string fields (username,
    // password, token, key, value) may carry formulas and are rendered like header values.
    const baseAuth = req.auth?.kind === 'inherit' ? (policy.auth ?? { kind: 'none' as const }) : req.auth;
    const auth: HttpAuth | undefined = baseAuth
      ? {
          ...baseAuth,
          username: baseAuth.username != null ? await render(baseAuth.username) : baseAuth.username,
          password: baseAuth.password != null ? await render(baseAuth.password) : baseAuth.password,
          token: baseAuth.token != null ? await render(baseAuth.token) : baseAuth.token,
          key: baseAuth.key != null ? await render(baseAuth.key) : baseAuth.key,
          value: baseAuth.value != null ? await render(baseAuth.value) : baseAuth.value,
        }
      : undefined;

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
    return { request: { ...req, url, headers, query, body, auth }, rendered, proxy };
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
