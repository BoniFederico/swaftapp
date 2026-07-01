import { makeError, type ErrorCategory, type ErrorEnvelope } from '@swaft/shared';

/**
 * A coded, transport-mappable service error. Services throw it; handlers translate it to the wire
 * error envelope via {@link toErrorEnvelope}. Keeps codes/categories part of the contract and
 * messages free of secrets. See SWAFT_ARCHITECTURE.md §5.2, SWAFT_SECURITY_MODEL.md (IPC-9).
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly category: ErrorCategory,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Map a thrown value to an error envelope when it is an AppError; otherwise return null. */
export function toErrorEnvelope(err: unknown): ErrorEnvelope | null {
  if (err instanceof AppError) {
    return makeError(err.code, err.category, err.message, err.details);
  }
  return null;
}
