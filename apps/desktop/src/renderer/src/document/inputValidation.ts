import { DATA_CAPABILITIES, type RenderResultDto, type RequirementDto } from '@swaft/shared';
import type { TranslationKey } from '../i18n/catalogs';

const DATA_CAPABILITY_SET = new Set<string>(DATA_CAPABILITIES);

/**
 * The input requirements actually **reached** by the latest render — so inputs gated behind a branch
 * that was not taken (Seebo collects `need(...)` lazily) are hidden, and progressive reveal works as
 * conditions resolve. Reached = the render's `pending` (unfilled, still needed) ∪ `resolved` (consumed)
 * ids. Data capabilities (e.g. `template`) are never inputs. Falls back to the full static set before
 * the first render and on a failed render (so a broken template still lets you fix its inputs).
 */
export function activeRequirements(
  requirements: RequirementDto[],
  result: RenderResultDto | null,
): RequirementDto[] {
  const inputs = requirements.filter((r) => !DATA_CAPABILITY_SET.has(r.capability));
  if (!result || result.status === 'failed') return inputs;
  const reached = new Set<string>([...result.pending.map((p) => p.id), ...result.resolved]);
  return inputs.filter((r) => reached.has(r.id));
}

/** An i18n key (+ params) describing why a value is invalid, or null when it is valid/empty. */
export type InputError = { key: TranslationKey; params?: Record<string, string> } | null;

export function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Drop empty entries before sending values to the engine. A cleared/removed input becomes "missing"
 * (not `null`) so the engine re-requests it instead of failing to infer a value from null/undefined.
 */
export function compactValues(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) if (!isEmpty(value)) out[key] = value;
  return out;
}

function rangeError(req: RequirementDto, n: number): InputError {
  const min = req.type?.min;
  const max = req.type?.max;
  if (min != null && n < min) return { key: 'val.min', params: { n: String(min) } };
  if (max != null && n > max) return { key: 'val.max', params: { n: String(max) } };
  return null;
}

/**
 * Validate a value against its requirement's type (the engine does not validate values, so the UI is
 * the only guard). Empty values are allowed — they are "unfilled", surfaced as pending by the engine.
 */
export function validateInput(req: RequirementDto, value: unknown): InputError {
  if (isEmpty(value)) return null;
  const kind = req.type?.kind ?? null;

  switch (kind) {
    case 'int': {
      const s = String(value).trim();
      if (!/^-?\d+$/.test(s)) return { key: 'val.int' };
      return rangeError(req, Number(s));
    }
    case 'float': {
      const s = String(value).trim();
      if (!/^-?\d+(\.\d+)?$/.test(s)) return { key: 'val.number' };
      const prec = req.type?.precision;
      const decimals = s.includes('.') ? s.split('.')[1]!.length : 0;
      if (prec != null && decimals > prec) return { key: 'val.precision', params: { n: String(prec) } };
      return rangeError(req, Number(s));
    }
    case 'duration':
      if (!/^\d{1,2}:\d{2}:\d{2}$/.test(String(value).trim())) {
        return { key: 'val.duration', params: { pattern: req.type?.pattern ?? 'HH:mm:ss' } };
      }
      return null;
    case 'object':
      // jsonInput stores a leftover string only when JSON.parse failed.
      return typeof value === 'string' ? { key: 'val.json' } : null;
    case 'string': {
      const max = req.type?.maxLength;
      if (max != null && String(value).length > max) {
        return { key: 'val.maxLength', params: { n: String(max) } };
      }
      return null;
    }
    default:
      return null;
  }
}

/** True when any requirement's current value is invalid (used to disable Render). */
export function hasInvalidInputs(
  reqs: RequirementDto[],
  values: Record<string, unknown>,
): boolean {
  return reqs.some((r) => validateInput(r, values[r.id]) !== null);
}
