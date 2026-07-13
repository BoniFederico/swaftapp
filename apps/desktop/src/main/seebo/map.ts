import type {
  ActionSummaryDto,
  DiagnosticDto,
  RenderResultDto,
  RequirementDto,
  RequirementTypeDto,
} from '@swaft/shared';
import type { SeeboAction, SeeboDiagnostic, SeeboRequirement, SeeboState } from './seebo-module';

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Extract the value type + constraints the UI needs for input validation. */
function toRequirementTypeDto(raw: unknown): RequirementTypeDto | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as {
    type?: unknown;
    format?: Record<string, unknown>;
    constraints?: Record<string, unknown>;
  };
  if (typeof t.type !== 'string') return null;
  const c = t.constraints ?? {};
  const f = t.format ?? {};
  return {
    kind: t.type,
    precision: num(c.precision),
    pattern: typeof f.pattern === 'string' ? f.pattern : null,
    min: num(c.min),
    max: num(c.max),
    maxLength: num(c.maxLength),
  };
}

/**
 * Choices for a listbox/multiOption. Static options come from `r.options`; **dynamic** options come
 * from a capability's resolved `args.candidates` (e.g. `multiOption({ …, args: { candidates: provider
 * match { … } } })`) — only present once the engine has actually reached/resolved the requirement.
 */
function toOptions(r: SeeboRequirement): string[] | null {
  if (Array.isArray(r.options)) return r.options.map(String);
  const candidates = (r as { args?: { candidates?: unknown } }).args?.candidates;
  if (Array.isArray(candidates)) return candidates.map(String);
  return null;
}

/** Map Seebo engine shapes to the transport DTOs (shared by Render + Batcher services). */
export function toRequirementDto(r: SeeboRequirement): RequirementDto {
  return {
    id: String(r.id),
    capability: typeof r.capability === 'string' ? r.capability : 'textbox',
    label: typeof r.label === 'string' ? r.label : null,
    options: toOptions(r),
    type: toRequirementTypeDto(r.type),
  };
}

/**
 * Human-readable message for a diagnostic. Driver diagnostics (e.g. a capability provider that threw)
 * carry only the code as their `message`; the real cause lives in `data.cause` (the thrown error's
 * message). Prefer that so failures like `env('MISSING')` read "Variable … is not defined" instead of
 * the opaque "CAPABILITY_ERROR".
 */
function diagnosticMessage(d: SeeboDiagnostic): string {
  const cause = d.data?.cause;
  if (typeof cause === 'string' && cause.trim() && cause !== d.code) return cause;
  return d.message && d.message !== d.code ? d.message : (d.message || d.code);
}

export function toDiagnosticDto(d: SeeboDiagnostic): DiagnosticDto {
  return { code: d.code, message: diagnosticMessage(d), position: d.position ?? null };
}

export function toActionSummaryDto(a: SeeboAction): ActionSummaryDto {
  return {
    id: String(a.id),
    type: String(a.type),
    environment: a.environment ?? 'test',
    requiresConfirmation: a.requiresConfirmation ?? a.status === 'pendingConfirmation',
    status: a.status,
  };
}

export function toRenderResult(state: SeeboState): RenderResultDto {
  const status =
    state.status === 'completed' || state.status === 'waiting' || state.status === 'failed'
      ? state.status
      : 'failed';
  return {
    status,
    output: typeof state.output === 'string' ? state.output : null,
    pending: (state.pending ?? []).map(toRequirementDto),
    diagnostics: (state.diagnostics ?? []).map(toDiagnosticDto),
    actions: (state.actions ?? []).map(toActionSummaryDto),
    resolved: state.resolved ? Object.keys(state.resolved) : [],
  };
}
