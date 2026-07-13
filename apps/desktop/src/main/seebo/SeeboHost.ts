import { BUILTIN_ACTION_HANDLERS } from './action-handlers';
import type {
  SeeboAction,
  SeeboActionExecutionResult,
  SeeboActionsModule,
  SeeboAnalysis,
  SeeboCapabilityDescriptor,
  SeeboCapabilityFn,
  SeeboDiagnostic,
  SeeboEngine,
  SeeboExecuteContext,
  SeeboModule,
  SeeboPolicy,
  SeeboRequirement,
  SeeboState,
} from './seebo-module';

/**
 * Host of the Seebo template engine (SWAFT_ARCHITECTURE.md §8). Each **input-widget capability** is
 * registered as an **interactive** capability (resolves to `undefined`), so the engine surfaces it as
 * a requirement for the host UI to fill — the capability NAME selects the front-end widget. Data
 * capabilities (API/DB) arrive in M8/M9.
 *
 * Seebo is ESM-only; we load it via dynamic `import()` so the (CJS) main bundle stays compatible.
 */
export const WIDGET_CAPABILITIES = [
  'textbox',
  'textarea',
  'number',
  'boolean',
  'listbox',
  'multiOption',
  'jsonInput',
  // NB: `datetime`/`duration` are reserved Seebo type names — widgets use distinct producer names.
  'datetimebox',
  'durationbox',
] as const;

export type WidgetCapability = (typeof WIDGET_CAPABILITIES)[number];

/**
 * The base Seebo **type** each widget capability contracts for (SPEC §1.6). Registered as the
 * capability's static contract so `need('number')` etc. inherit the right type without the template
 * repeating `type:int()` — a bare `${ number('x') }` then validates its value as an int instead of
 * defaulting to `string` (which accepted any text). A template may still override the type per call.
 * `number` defaults to `int` (matching the UI's integer-first widget); use `type:float()` for decimals.
 */
const WIDGET_TYPES: Record<WidgetCapability, string> = {
  textbox: 'string',
  textarea: 'string',
  number: 'int',
  boolean: 'bool',
  listbox: 'string',
  multiOption: 'array',
  jsonInput: 'object',
  datetimebox: 'datetime',
  durationbox: 'duration',
};

/**
 * Non-widget **data** capabilities ({@link DATA_CAPABILITIES}, shared with the renderer): unlike
 * widgets (which suspend for UI input), these resolve a real value during the drive loop. `template`
 * reads another `json` template's content as a Seebo object. Always allow-listed (like widgets), but
 * only registered when a {@link TemplateDataProvider} is wired.
 */
/** Resolves the `template(...)` data-capability: another `json` template's content, as a JS value. */
export interface TemplateDataProvider {
  /** Resolve `ref` (a template name) within `projectId` to its parsed JSON content, or throw. */
  resolve(ref: string, projectId: string | null): Promise<unknown>;
}

/** Resolves the `env(...)` data-capability: a variable from the workspace's active environment. */
export interface EnvDataProvider {
  /** Resolve `key` to the active environment's value (no user prompt), or throw when absent. */
  resolve(key: string): Promise<unknown>;
}

/** Per-render context so data capabilities can scope their lookups (e.g. `template` → same project). */
export interface SeeboRenderContext {
  projectId: string | null;
  templateId: string | null;
}

export interface SeeboHostOptions {
  /** Workspace locale (BCP-47), e.g. `it-IT`. */
  locale?: string;
  /** Injectable clock for deterministic previews/tests. */
  now?: () => Date;
}

/** Collaborators a host needs for data capabilities; omitted in pure (widget-only) engines/tests. */
export interface SeeboHostDeps {
  templateData?: TemplateDataProvider;
  envData?: EnvDataProvider;
}

/** Per-render policy derived from workspace settings (only non-empty allow-lists restrict). */
export interface RenderPolicy {
  allowedCapabilities?: string[];
  allowedTypes?: string[];
}

/**
 * The target template name passed to a `template(...)` capability call. Seebo forwards a call's
 * descriptor to the resolver; we accept the name from `args.ref`, a top-level `ref`, or the
 * requirement `id` (so `template({ ref: 'cfg' })` and `template({ id: 'cfg' })` both work).
 */
function templateRef(req: SeeboRequirement): string {
  const args = (req as { args?: unknown }).args;
  if (args && typeof args === 'object' && 'ref' in args) {
    const v = (args as { ref?: unknown }).ref;
    if (typeof v === 'string') return v;
  }
  const direct = (req as { ref?: unknown }).ref;
  if (typeof direct === 'string') return direct;
  return typeof req.id === 'string' ? req.id : String(req.id ?? '');
}

/**
 * The variable name passed to an `env(...)` capability call. Accepts `env({ key: 'API_URL' })`,
 * `env({ ref: 'API_URL' })`, or the requirement `id` (so `env({ id: 'API_URL', type: string() })`
 * works, mirroring the `template(...)` convention).
 */
function envKey(req: SeeboRequirement): string {
  const args = (req as { args?: Record<string, unknown> }).args;
  if (args && typeof args === 'object') {
    const v = args.key ?? args.ref;
    if (typeof v === 'string') return v;
  }
  const direct = (req as { ref?: unknown }).ref;
  if (typeof direct === 'string') return direct;
  return typeof req.id === 'string' ? req.id : String(req.id ?? '');
}

export class SeeboHost {
  private modulePromise?: Promise<SeeboModule>;
  private actionsPromise?: Promise<SeeboActionsModule>;

  constructor(
    private readonly opts: SeeboHostOptions = {},
    private readonly deps: SeeboHostDeps = {},
  ) {}

  private loadSeebo(): Promise<SeeboModule> {
    // Non-literal specifier so TS treats the (untyped, ESM-only) module as `any`; we cast to the
    // local typed facade. Runtime resolves the real `seebo` package (externalized).
    if (!this.modulePromise) {
      this.modulePromise = import('seebo' as string) as Promise<SeeboModule>;
    }
    return this.modulePromise;
  }

  private loadActions(): Promise<SeeboActionsModule> {
    if (!this.actionsPromise) {
      this.actionsPromise = import('seebo/actions' as string) as Promise<SeeboActionsModule>;
    }
    return this.actionsPromise;
  }

  private async engine(policy?: RenderPolicy, ctx?: SeeboRenderContext): Promise<SeeboEngine> {
    const { createEngine, defineCapability } = await this.loadSeebo();
    // Each widget resolves to `undefined` (suspends for UI input); its `type` contract makes the
    // requirement carry the widget's natural type instead of defaulting to `string`.
    const capabilities: Record<string, SeeboCapabilityFn | SeeboCapabilityDescriptor> =
      Object.fromEntries(
        WIDGET_CAPABILITIES.map((name) => [
          name,
          defineCapability(name, { type: WIDGET_TYPES[name], resolve: () => undefined }),
        ]),
      );
    // Register `template` (a data capability) only when a provider is wired — pure widget engines
    // (e.g. tests, the Template Editor without a workspace) keep their original surface untouched.
    const dataCapabilities: string[] = [];
    const { templateData, envData } = this.deps;
    if (templateData) {
      // Declare an `object` contract so member access (`template('cfg').baseUrl`) type-checks without
      // the template repeating `type:object()`; a JSON object would otherwise fail the default (string)
      // validation with CAPABILITY_INVALID_VALUE. Templates can still override the type when needed.
      capabilities.template = defineCapability('template', {
        type: 'object',
        resolve: (req) => templateData.resolve(templateRef(req), ctx?.projectId ?? null),
      });
      dataCapabilities.push('template');
    }
    // `env` resolves against the workspace's active environment (global, not project-scoped), so it
    // needs no render context — it works everywhere Seebo runs (documents, API fields, editor preview).
    if (envData) {
      capabilities.env = (req) => envData.resolve(envKey(req));
      dataCapabilities.push('env');
    }
    const alwaysAllowed = [...WIDGET_CAPABILITIES, ...dataCapabilities];

    const enginePolicy: SeeboPolicy = { trustLevel: 'trusted' };
    // Widgets + data capabilities are always allowed (the input/data mechanism). An empty list means
    // "no restriction"; a non-empty one still keeps the always-allowed set reachable.
    if (policy?.allowedCapabilities && policy.allowedCapabilities.length > 0) {
      enginePolicy.allowedCapabilities = [
        ...new Set([...alwaysAllowed, ...policy.allowedCapabilities]),
      ];
    }
    if (policy?.allowedTypes && policy.allowedTypes.length > 0) {
      enginePolicy.allowedTypes = policy.allowedTypes;
    }

    const engine = createEngine({
      capabilities,
      locale: this.opts.locale,
      clock: this.opts.now,
      policy: enginePolicy,
    });
    // Register the code-defined action handlers so `validate`/execution know the types.
    for (const [type, handler] of Object.entries(BUILTIN_ACTION_HANDLERS)) {
      engine.defineAction(type, handler);
    }
    return engine;
  }

  /** Static analysis: the requirements (widgets) a template needs, with type/options. */
  async analyze(
    source: string,
    policy?: RenderPolicy,
    ctx?: SeeboRenderContext,
  ): Promise<SeeboAnalysis> {
    return (await this.engine(policy, ctx)).analyze(source);
  }

  /** Static diagnostics (never throws) for live editor feedback. */
  async validate(source: string, policy?: RenderPolicy): Promise<SeeboDiagnostic[]> {
    return (await this.engine(policy)).validate(source);
  }

  /** Render a template with the provided input values. May return waiting/failed states. */
  async render(
    source: string,
    values: Record<string, unknown>,
    policy?: RenderPolicy,
    ctx?: SeeboRenderContext,
  ): Promise<SeeboState> {
    return (await this.engine(policy, ctx)).stebo({ template: source, values });
  }

  /** Render a composite template (Batcher) with named sub-templates (ABSORB/MERGE merge macros). */
  async renderComposite(
    template: string,
    templates: Record<string, string>,
    values: Record<string, unknown>,
    policy?: RenderPolicy,
  ): Promise<SeeboState> {
    return (await this.engine(policy)).stebo({ template, templates, values });
  }

  /**
   * Execute a prepared action plan via the `seebo/actions` layer (the pure core never executes).
   * A fresh engine carries the same code-defined handlers; the caller supplies confirmation/policy.
   */
  async executeActions(
    plan: SeeboAction[],
    ctx: Omit<SeeboExecuteContext, 'engine'>,
    policy?: RenderPolicy,
  ): Promise<SeeboActionExecutionResult> {
    const engine = await this.engine(policy);
    const { executeActionPlan } = await this.loadActions();
    return executeActionPlan(plan, { engine, ...ctx });
  }
}
