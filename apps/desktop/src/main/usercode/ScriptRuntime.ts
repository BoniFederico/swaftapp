import { AppError } from '../errors';
import type { ScriptErrorCode, ScriptRunOutcome, ScriptRunRequest } from './contract';

/**
 * The seam between Swaft and whatever actually executes user JavaScript. The production
 * implementation is {@link UtilityProcessRuntime} (a separate OS process); tests inject a fake.
 *
 * There is deliberately **no in-process fallback**. The DB worker degrades gracefully to an
 * in-process backend because the worker there is a performance choice; here the separate process
 * *is* the security boundary, so losing it must fail loudly rather than silently run user code in
 * the main process.
 */
export interface ScriptRuntime {
  run(request: ScriptRunRequest): Promise<ScriptRunOutcome>;
  dispose(): Promise<void>;
}

/**
 * Turn a script-host failure into the app's error envelope, keeping the specific code and carrying
 * whatever the code logged before it failed — that is usually what explains the failure.
 */
export function scriptError(
  code: ScriptErrorCode,
  message: string,
  name?: string,
  logs: string[] = [],
): AppError {
  return new AppError(
    code,
    code === 'USER_CODE_HOST_UNAVAILABLE' ? 'internal' : 'validation',
    name ? `${name}: ${message}` : message,
    logs.length > 0 ? { logs } : undefined,
  );
}
