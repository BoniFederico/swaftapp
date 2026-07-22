/**
 * Transport-agnostic coded error envelope shared by IPC (desktop) and the future HTTP transport.
 *
 */

export type ErrorCategory =
  | 'policy'
  | 'validation'
  | 'execution'
  | 'auth'
  | 'not_found'
  | 'internal';

export interface SwaftError {
  /** Stable error code (never switch on `message`). */
  code: string;
  message: string;
  category: ErrorCategory;
  /** Non-secret structured details. MUST NOT contain secrets. */
  details?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  error: SwaftError;
}

/** A successful op result is wrapped so transports can distinguish ok vs error uniformly. */
export interface OkEnvelope<T> {
  ok: true;
  data: T;
}

export type ResultEnvelope<T> = OkEnvelope<T> | ErrorEnvelope;

export function makeError(
  code: string,
  category: ErrorCategory,
  message: string,
  details?: Record<string, unknown>,
): ErrorEnvelope {
  return { error: { code, category, message, ...(details ? { details } : {}) } };
}

export function ok<T>(data: T): OkEnvelope<T> {
  return { ok: true, data };
}

export function isError<T>(r: ResultEnvelope<T>): r is ErrorEnvelope {
  return (r as ErrorEnvelope).error !== undefined;
}
