/**
 * Typed surface for the `seebo` package (published JS/ESM without type declarations). Mapped to the
 * `seebo` specifier via tsconfig `paths` so the main process gets types; at runtime the real package
 * is loaded (vite/vitest do not honor tsconfig paths). Covers only what Swaft uses (docs/seebo).
 */
export interface SeeboRequirement {
  id: string;
  /** Widget type; the capability name. */
  capability?: string;
  label?: string;
  type?: unknown;
  options?: unknown[];
  phase?: string;
  [k: string]: unknown;
}

export interface SeeboDiagnostic {
  code: string;
  message: string;
  position?: { start: number; end: number };
  data?: Record<string, unknown>;
}

export interface SeeboAnalysis {
  requirements: SeeboRequirement[];
  capabilitiesUsed: string[];
  deterministic: boolean;
  executionPlan?: unknown;
  /** Statically-detected actions in document order (best-effort metadata). */
  actions?: SeeboAction[];
}

/** A prepared action in a render's plan (the core only prepares; it never executes). */
export interface SeeboAction {
  id: string;
  type: string;
  input?: Record<string, unknown>;
  status: string; // 'pendingConfirmation' | 'ready' | 'blocked' | …
  environment: string;
  requiresConfirmation?: boolean;
  dryRun?: boolean;
  idempotencyKey?: string;
  permissions?: string[];
  [k: string]: unknown;
}

export interface SeeboState {
  status: 'completed' | 'waiting' | 'failed' | 'in_progress' | string;
  output?: string;
  pending?: SeeboRequirement[];
  diagnostics?: SeeboDiagnostic[];
  resolved?: Record<string, unknown>;
  actions?: SeeboAction[];
  [k: string]: unknown;
}

/** A code-defined action handler (`engine.defineAction`). */
export interface SeeboActionHandler {
  requiredPermissions?: string[];
  allowedEnvironments?: string[];
  dryRun?(input: Record<string, unknown>, ctx: SeeboActionContext): Promise<unknown> | unknown;
  execute(input: Record<string, unknown>, ctx: SeeboActionContext): Promise<unknown> | unknown;
  compensate?(receipt: SeeboActionReceipt, ctx: SeeboActionContext): Promise<unknown> | unknown;
}

export interface SeeboActionContext {
  environment?: string;
  actor?: unknown;
  clients?: Record<string, unknown>;
  idempotencyKey?: string;
  [k: string]: unknown;
}

export interface SeeboActionReceipt {
  actionId: string;
  type: string;
  status: string; // 'succeeded' | 'failed' | 'skipped' | 'compensated' | …
  environment: string;
  dryRun?: boolean;
  idempotencyKey?: string;
  durationMs?: number;
  attempts?: number;
  actor?: unknown;
  output?: unknown;
  error?: { code?: string; message?: string; retryable?: boolean } | null;
  [k: string]: unknown;
}

export interface SeeboActionExecutionResult {
  status: 'completed' | 'partial' | 'failed' | 'skipped' | string;
  dryRun: boolean;
  receipts: SeeboActionReceipt[];
  succeeded: number;
  failed: number;
  skipped: number;
}

/** Context passed to `executeActionPlan` (the host-owned execution layer). */
export interface SeeboExecuteContext {
  engine: SeeboEngine;
  dryRun?: boolean;
  actor?: unknown;
  permissions?: string[];
  environment?: string;
  confirmedActions?: string[];
  /** Action-type / environment allow-deny policy (fail-closed when a list is present). */
  policy?: {
    allowedActions?: string[];
    deniedActions?: string[];
    allowedEnvironments?: string[];
  };
  failFast?: boolean;
  clients?: Record<string, unknown>;
  audit?: (event: { type?: string; [k: string]: unknown }) => void;
  redact?: (value: unknown, ctx: { actionId: string; type: string; field?: string }) => unknown;
}

export interface SeeboPolicy {
  trustLevel?: 'trusted' | 'untrusted';
  allowedCapabilities?: string[];
  allowedTypes?: string[];
  allowedFunctions?: string[];
  capabilityRules?: Record<string, unknown>;
  redact?: string[];
  audit?: (...args: unknown[]) => void;
}

export interface SeeboConfig {
  capabilities?: Record<string, (req: SeeboRequirement) => unknown>;
  functions?: unknown[];
  libraries?: unknown[];
  types?: unknown[];
  macros?: unknown[];
  locale?: string;
  clock?: () => Date;
  policy?: SeeboPolicy;
  limits?: Record<string, number>;
}

export interface SteboInput {
  template: string;
  values?: Record<string, unknown>;
  templates?: Record<string, string>;
  policy?: SeeboPolicy;
}

export interface SeeboEngine {
  analyze(source: string): SeeboAnalysis;
  validate(source: string): SeeboDiagnostic[];
  stebo(input: SteboInput): Promise<SeeboState>;
  drive(input: unknown, opts?: { stopOn?: string[] }): Promise<SeeboState>;
  defineAction(type: string, handler: SeeboActionHandler): void;
}

/** The shape of the `seebo` module namespace (the subset Swaft calls). */
export interface SeeboModule {
  createEngine(config: SeeboConfig): SeeboEngine;
}

/** The shape of the `seebo/actions` execution-layer module (the subset Swaft calls). */
export interface SeeboActionsModule {
  executeActionPlan(
    plan: SeeboAction[],
    ctx: SeeboExecuteContext,
  ): Promise<SeeboActionExecutionResult>;
}
