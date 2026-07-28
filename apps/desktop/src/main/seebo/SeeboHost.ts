import { DATA_CAPABILITIES } from '@swaft/shared';
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
 * Host of the Seebo template engine. Each **input-widget capability** is
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

/**
 * Resolves the `secret(...)` data-capability: a secret value from the OS keychain. Main-process only —
 * the value never reaches the renderer and is masked in diagnostics/audit (`policy.redact`). Lenient:
 * an absent secret resolves to `''` so a preview/render never crashes on a machine where it isn't set.
 */
export interface SecretDataProvider {
  /** Resolve `name` to its stored secret value, or `''` when absent. Never throws. */
  resolve(name: string): Promise<string> | string;
}

/** Per-render context so data capabilities can scope their lookups (e.g. `template` → same project). */
export interface SeeboRenderContext {
  projectId: string | null;
  templateId: string | null;
  /**
   * Present only while a scenario run renders one of its blocks (set by the scenario runner). Carries
   * the output **envelopes** of already-executed blocks, keyed by alias/node id, so `previous(...)`
   * resolves them. Absent everywhere else, so `previous(...)` is null (an empty object) standalone.
   */
  scenario?: {
    outputs: Record<string, unknown>;
    /** Alias/id of the immediate predecessor on the taken path (the `previous()` no-arg form). */
    previousAlias?: string | null;
  };
}

export interface SeeboHostOptions {
  /** Workspace locale (BCP-47), e.g. `it-IT`. */
  locale?: string;
  /** Injectable clock for deterministic previews/tests. */
  now?: () => Date;
}

/** A user-authored capability, as the engine needs to see it: a name and its value contract. */
export interface UserCapabilityRegistration {
  name: string;
  /** Seebo base type the resolved value is validated against. */
  type: string;
}

/**
 * Supplies the capabilities users wrote themselves (`capability` templates). Kept as an interface so
 * the host stays unaware of the script runtime, and so tests can register capabilities without
 * spawning a process.
 */
export interface UserCapabilityProvider {
  /** Registrable capabilities. Called once per engine, so it must be cached, not recomputed. */
  list(): Promise<UserCapabilityRegistration[]>;
  /** Run one call; `requirement` is the descriptor the engine flattened (id plus author fields). */
  resolve(name: string, requirement: Record<string, unknown>): Promise<unknown>;
  /** Registrable action types, so `action({ type: 'myAction' })` is a known effect. */
  listActions(): Promise<{ name: string }[]>;
  /** Perform (or dry-run) one action; the returned value becomes its receipt payload. */
  runAction(
    name: string,
    input: Record<string, unknown>,
    opts: { api?: unknown; dryRun?: boolean },
  ): Promise<{ value: unknown }>;
}

/** Collaborators a host needs for data capabilities; omitted in pure (widget-only) engines/tests. */
export interface SeeboHostDeps {
  templateData?: TemplateDataProvider;
  envData?: EnvDataProvider;
  secretData?: SecretDataProvider;
  userCapabilities?: UserCapabilityProvider;
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
 * The block reference passed to a `previous(...)` capability call — an alias (or node id). The
 * canonical form is `previous('login')` (→ id); `previous({ ref: 'login' })` / `{ alias: 'login' }`
 * also work. When no ref is given, the runner-supplied `previousAlias` (immediate predecessor) is used.
 */
function previousRef(req: SeeboRequirement): string | null {
  const args = (req as { args?: Record<string, unknown> }).args;
  if (args && typeof args === 'object') {
    const v = args.ref ?? args.alias;
    if (typeof v === 'string') return v;
  }
  const direct = (req as { ref?: unknown }).ref;
  if (typeof direct === 'string') return direct;
  return typeof req.id === 'string' && req.id ? req.id : null;
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

/**
 * The secret name passed to a `secret(...)` capability call. Accepts `secret({ name: 'API_TOKEN' })`,
 * `secret({ key: … })`, `secret({ ref: … })`, or the requirement `id` (so `secret('API_TOKEN')`
 * works), mirroring the `env(...)` convention.
 */
function secretName(req: SeeboRequirement): string {
  const args = (req as { args?: Record<string, unknown> }).args;
  if (args && typeof args === 'object') {
    const v = args.name ?? args.key ?? args.ref;
    if (typeof v === 'string') return v;
  }
  const direct = (req as { ref?: unknown }).ref;
  if (typeof direct === 'string') return direct;
  return typeof req.id === 'string' ? req.id : String(req.id ?? '');
}

/**
 * The names appearing as a **whole-slot bare identifier** — `${ name }` (also `#{`/`@{`). Only
 * these are eligible for the env-fallback sugar; anything else inside a slot (literals, member
 * access, operators, calls) keeps Seebo's own semantics and diagnostics.
 */
const BARE_SLOT = /[$#@]\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g;
function bareSlotNames(sources: string[]): Set<string> {
  const names = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(BARE_SLOT)) names.add(m[1]!);
  }
  return names;
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
    const { templateData, envData, secretData, userCapabilities } = this.deps;
    // `previous(...)` carries an already-executed scenario block's output envelope into a later block.
    // Registered unconditionally (it needs no provider — only the per-render `ctx.scenario` the runner
    // sets). Outside a run it resolves to an empty object, so a block template stays renderable on its
    // own; inside a run it returns the stored envelope. `object` contract → member access type-checks.
    capabilities.previous = defineCapability('previous', {
      type: 'object',
      resolve: (req) => {
        const s = ctx?.scenario;
        if (!s) return {};
        const key = previousRef(req) ?? s.previousAlias ?? null;
        return (key ? s.outputs[key] : undefined) ?? {};
      },
    });
    dataCapabilities.push('previous');
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
    // `secret` resolves a value from the OS keychain (main-process only). Its value is masked in
    // diagnostics/audit via `policy.redact` below; a missing secret resolves to '' (never throws).
    if (secretData) {
      capabilities.secret = defineCapability('secret', {
        type: 'string',
        resolve: (req) => secretData.resolve(secretName(req)),
      });
      dataCapabilities.push('secret');
    }
    // User-authored capabilities resolve like any other data capability; the difference is that the
    // resolver forwards to an isolated process instead of running here. A built-in always wins, so a
    // capability template can never change what an existing template means.
    if (userCapabilities) {
      for (const { name, type } of await userCapabilities.list()) {
        if (name in capabilities) continue;
        capabilities[name] = defineCapability(name, {
          type,
          resolve: (req) => userCapabilities.resolve(name, req as Record<string, unknown>),
        });
        dataCapabilities.push(name);
      }
    }
    const alwaysAllowed = [...WIDGET_CAPABILITIES, ...dataCapabilities];

    const enginePolicy: SeeboPolicy = { trustLevel: 'trusted' };
    // Mask `secret(...)` values wherever the engine surfaces values (diagnostics, audit hook).
    if (secretData) enginePolicy.redact = ['secret'];
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
    // User-authored actions become action types of their own. Confirmation, policy and receipts stay
    // with Seebo's execution layer (ActionService); this only says what the effect *is*. A built-in
    // type always wins, as with capabilities.
    if (userCapabilities) {
      for (const { name } of await userCapabilities.listActions()) {
        if (name in BUILTIN_ACTION_HANDLERS) continue;
        engine.defineAction(name, {
          allowedEnvironments: ['test', 'preprod', 'prod'],
          dryRun: (input) => userCapabilities.runAction(name, input, { dryRun: true }),
          execute: (input) => userCapabilities.runAction(name, input, { dryRun: false }),
        });
      }
    }
    return engine;
  }

  /**
   * Capabilities that resolve to a value instead of asking the user for one — the built-in data
   * capabilities plus every registered user capability. Callers use it to keep those out of input
   * panels: `analyze` reports them as requirements exactly like a widget, and only the host knows
   * which names are user-authored (the renderer's static `DATA_CAPABILITIES` list cannot).
   */
  async dataCapabilityNames(): Promise<ReadonlySet<string>> {
    const names = new Set<string>(DATA_CAPABILITIES);
    for (const { name } of (await this.deps.userCapabilities?.list()) ?? []) names.add(name);
    return names;
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
    const diagnostics = (await this.engine(policy)).validate(source);
    // Env-fallback sugar (see render): don't flag a whole-slot `${ name }` when `name` is an env
    // variable. Names used inside larger expressions are NOT eligible and stay flagged.
    const { envData } = this.deps;
    if (!envData || !diagnostics.some((d) => d.code === 'UNDECLARED_NAME')) return diagnostics;
    const eligible = bareSlotNames([source]);
    const kept: SeeboDiagnostic[] = [];
    for (const d of diagnostics) {
      const name = d.code === 'UNDECLARED_NAME' ? d.data?.name : undefined;
      if (typeof name === 'string' && eligible.has(name)) {
        try {
          await envData.resolve(name);
          continue; // resolvable from the active environment → the sugar will cover it
        } catch {
          /* not an env var → keep the diagnostic */
        }
      }
      kept.push(d);
    }
    return kept;
  }

  /** Render a template with the provided input values. May return waiting/failed states. */
  async render(
    source: string,
    values: Record<string, unknown>,
    policy?: RenderPolicy,
    ctx?: SeeboRenderContext,
  ): Promise<SeeboState> {
    const engine = await this.engine(policy, ctx);
    return this.withEnvFallback(
      (v) => engine.stebo({ template: source, values: v }),
      values,
      bareSlotNames([source]),
    );
  }

  /** Render a composite template (Batcher) with named sub-templates (ABSORB/MERGE merge macros). */
  async renderComposite(
    template: string,
    templates: Record<string, string>,
    values: Record<string, unknown>,
    policy?: RenderPolicy,
  ): Promise<SeeboState> {
    const engine = await this.engine(policy);
    return this.withEnvFallback(
      (v) => engine.stebo({ template, templates, values: v }),
      values,
      bareSlotNames([template, ...Object.values(templates)]),
    );
  }

  /** The distinct names a failed state flags as `UNDECLARED_NAME`. */
  private static undeclaredNames(state: SeeboState): string[] {
    const names = (state.diagnostics ?? [])
      .filter((d) => d.code === 'UNDECLARED_NAME')
      .map((d) => d.data?.name)
      .filter((n): n is string => typeof n === 'string');
    return [...new Set(names)];
  }

  /**
   * Env-fallback sugar: a **whole-slot bare** `${ name }` Seebo does not recognize
   * (`UNDECLARED_NAME`) is retried as the active environment's variable of the same name —
   * `${ pesca }` behaves like `${ env('pesca') }` when `pesca` exists in the environment. Only
   * names in `eligible` (extracted as `${ name }` slots from the source) are tried: string
   * literals and names inside larger expressions (`${ name.x }`, `${ name + 1 }`) never fall
   * back. Unresolvable names keep their original diagnostic. Bounded loop: each pass must
   * resolve at least one NEW name.
   */
  private async withEnvFallback(
    run: (values: Record<string, unknown>) => Promise<SeeboState>,
    values: Record<string, unknown>,
    eligible: Set<string>,
  ): Promise<SeeboState> {
    let state = await run(values);
    const { envData } = this.deps;
    if (!envData || eligible.size === 0) return state;
    let current = values;
    for (let pass = 0; pass < 5 && state.status === 'failed'; pass++) {
      const names = SeeboHost.undeclaredNames(state).filter(
        (n) => eligible.has(n) && !(n in current),
      );
      if (names.length === 0) break;
      const resolved: Record<string, unknown> = {};
      for (const name of names) {
        try {
          resolved[name] = await envData.resolve(name);
        } catch {
          /* not an env var → the original diagnostic stands */
        }
      }
      if (Object.keys(resolved).length === 0) break;
      current = { ...current, ...resolved };
      state = await run(current);
    }
    return state;
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
