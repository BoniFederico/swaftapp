import type {
  HttpRequestModel,
  HttpResponseDto,
  RequestAction,
  RequestActionOutcomeDto,
} from '@swaft/shared';
import { AppError } from '../errors';
import type { HttpService } from '../http/HttpService';
import type { UserCodeRegistry } from '../usercode/UserCodeRegistry';
import type { ApiHistoryService } from './ApiHistoryService';
import type { ApiRequestService } from './ApiRequestService';

/** The shape an action sees as `api`: the request, plus the response once there is one. */
interface ApiContext {
  request: HttpRequestModel;
  response?: HttpResponseDto & { json?: unknown };
}

export interface ApiRunServiceDeps {
  requests: ApiRequestService;
  http: HttpService;
  history: ApiHistoryService;
  code: UserCodeRegistry;
}

/**
 * Runs one API request end to end: resolve its formulas, run the `pre` actions, send, run the
 * `post` actions, record the history. Extracted from the `http.send` handler so the ordering — and
 * the rule that a failing `pre` action stops the send — lives in one readable place.
 *
 * A `pre` action may reshape the request by returning `{ patch: { … } }`. The patch is merged
 * explicitly rather than letting the action mutate the request in place: what changed stays
 * inspectable, shows up in the "Request render" tab, and cannot be done by accident.
 */
export class ApiRunService {
  constructor(private readonly deps: ApiRunServiceDeps) {}

  async send(
    templateId: string | undefined,
    request: HttpRequestModel,
    values: Record<string, unknown>,
  ): Promise<{
    response: HttpResponseDto;
    rendered: boolean;
    request?: HttpRequestModel;
    actions?: RequestActionOutcomeDto[];
  }> {
    // Without a template there is no project context and no attached actions: send it verbatim.
    if (!templateId) {
      return { response: await this.deps.http.send(request), rendered: false };
    }

    const resolved = await this.deps.requests.resolve(templateId, request, values);
    let outgoing = resolved.request;
    const attached = (request.actions ?? []).filter((a) => a.enabled !== false);
    const outcomes: RequestActionOutcomeDto[] = [];

    for (const action of attached.filter((a) => a.trigger === 'pre')) {
      const outcome = await this.runAction(action, { request: outgoing });
      outcomes.push(outcome);
      if (outcome.status === 'failed') {
        // The point of a `pre` action is to make the request valid (sign it, refresh a token); if it
        // could not, sending anyway would produce a confusing HTTP error instead of the real cause.
        // Persist what ran so the failure is in the Pre-Action history, then stop.
        await this.deps.history.recordActions(templateId, outcomes);
        throw new AppError(
          'REQUEST_ACTION_FAILED',
          'validation',
          `Pre-request action "${action.ref}" failed: ${outcome.error ?? 'unknown error'}`,
          { actions: outcomes },
        );
      }
      outgoing = applyPatch(outgoing, outcome.output);
    }

    const response = await this.deps.http.send(outgoing, { proxy: resolved.proxy });
    await this.deps.history.record(templateId, outgoing.method, outgoing.url, response.status);

    if (attached.some((a) => a.trigger === 'post')) {
      const api: ApiContext = { request: outgoing, response: { ...response, json: parseJson(response.body) } };
      for (const action of attached.filter((a) => a.trigger === 'post')) {
        // A failing `post` action must not hide the response: it is reported, not thrown.
        outcomes.push(await this.runAction(action, api));
      }
    }

    // Persist the run's outcomes so the Pre/Post-Action tabs accumulate a history, like the request
    // history does.
    await this.deps.history.recordActions(templateId, outcomes);

    const rendered = resolved.rendered || outcomes.length > 0;
    return {
      response,
      rendered,
      request: rendered ? outgoing : undefined,
      actions: outcomes.length > 0 ? outcomes : undefined,
    };
  }

  private async runAction(action: RequestAction, api: ApiContext): Promise<RequestActionOutcomeDto> {
    const base = { ref: action.ref, trigger: action.trigger, output: null, logs: [], envWrites: [] };
    try {
      const res = await this.deps.code.runAction(action.ref, action.input ?? {}, { api });
      return { ...base, status: 'succeeded', output: res.value, logs: res.logs, envWrites: res.envWrites, error: null };
    } catch (err) {
      return {
        ...base,
        status: 'failed',
        error: err instanceof AppError ? err.message : String(err),
        logs: Array.isArray((err as AppError)?.details?.logs) ? ((err as AppError).details!.logs as string[]) : [],
      };
    }
  }
}

/** JSON responses are the common case; hand actions the parsed body so they need not re-parse it. */
function parseJson(body: string | null | undefined): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * Merge a `pre` action's `{ patch }` into the request. Only the fields a request actually has are
 * considered, and headers/query merge key-by-key so an action can add one without restating the
 * rest. Anything else the action returned is receipt payload, not a patch.
 */
function applyPatch(request: HttpRequestModel, output: unknown): HttpRequestModel {
  if (!output || typeof output !== 'object') return request;
  const patch = (output as { patch?: unknown }).patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return request;
  const p = patch as Partial<HttpRequestModel>;
  return {
    ...request,
    ...(typeof p.url === 'string' ? { url: p.url } : {}),
    ...(typeof p.body === 'string' || p.body === null ? { body: p.body } : {}),
    ...(p.headers ? { headers: { ...request.headers, ...p.headers } } : {}),
    ...(p.query ? { query: { ...request.query, ...p.query } } : {}),
  };
}
