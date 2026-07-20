import { describe, it, expect, vi } from 'vitest';
import type { HttpRequestModel, HttpResponseDto, RequestAction } from '@swaft/shared';
import { AppError } from '../errors';
import type { HttpService } from '../http/HttpService';
import type { UserCodeRegistry } from '../usercode/UserCodeRegistry';
import type { ApiHistoryService } from './ApiHistoryService';
import type { ApiRequestService } from './ApiRequestService';
import { ApiRunService } from './ApiRunService';

const RESPONSE: HttpResponseDto = {
  status: 200,
  statusText: 'OK',
  headers: {},
  body: '{"token":"tok-1"}',
  durationMs: 1,
};

/** Wires an ApiRunService whose collaborators are all recorded fakes. */
function setup(
  runAction: (ref: string, input: Record<string, unknown>, opts: { api?: unknown }) => Promise<{
    value: unknown;
    logs: string[];
    envWrites: string[];
  }> = () => Promise.resolve({ value: null, logs: [], envWrites: [] }),
  /** Actions the request "inherits" from its folder chain (apply order: outermost first). */
  folderActions: RequestAction[] = [],
) {
  const sent: { request: HttpRequestModel }[] = [];
  const seen: { ref: string; input: Record<string, unknown>; api: unknown }[] = [];
  const history: string[] = [];

  const service = new ApiRunService({
    requests: {
      resolve: (_id: string, req: HttpRequestModel) =>
        Promise.resolve({ request: req, rendered: false, proxy: null, folderActions }),
    } as unknown as ApiRequestService,
    http: {
      send: (request: HttpRequestModel) => {
        sent.push({ request });
        return Promise.resolve(RESPONSE);
      },
    } as unknown as HttpService,
    history: {
      record: (_t: string, _m: string, url: string) => {
        history.push(url);
        return Promise.resolve([]);
      },
      recordActions: () => Promise.resolve(),
    } as unknown as ApiHistoryService,
    code: {
      runAction: (ref: string, input: Record<string, unknown>, opts: { api?: unknown }) => {
        seen.push({ ref, input, api: opts.api });
        return runAction(ref, input, opts);
      },
    } as unknown as UserCodeRegistry,
  });
  return { service, sent, seen, history };
}

const REQUEST: HttpRequestModel = { method: 'GET', url: 'https://api.test/login', headers: { A: '1' } };

describe('ApiRunService', () => {
  it('runs pre actions before the call and post actions after it', async () => {
    const order: string[] = [];
    const { service, seen } = setup((ref) => {
      order.push(ref);
      return Promise.resolve({ value: null, logs: [], envWrites: [] });
    });

    const res = await service.send('t1', {
      ...REQUEST,
      actions: [
        { ref: 'after', trigger: 'post' },
        { ref: 'before', trigger: 'pre' },
      ],
    }, {});

    // Declaration order does not decide it: the trigger does.
    expect(order).toEqual(['before', 'after']);
    expect(res.actions?.map((a) => a.ref)).toEqual(['before', 'after']);
    // Only the post action sees a response.
    expect((seen[0]!.api as { response?: unknown }).response).toBeUndefined();
    expect((seen[1]!.api as { response?: unknown }).response).toBeDefined();
  });

  it('hands a post action the parsed JSON body, so it need not re-parse it', async () => {
    const { service, seen } = setup();
    await service.send('t1', { ...REQUEST, actions: [{ ref: 'grab', trigger: 'post' }] }, {});

    const api = seen[0]!.api as { response: { json: { token: string }; status: number } };
    expect(api.response.json).toEqual({ token: 'tok-1' });
    expect(api.response.status).toBe(200);
  });

  it('merges a pre action patch into the request instead of letting it mutate anything', async () => {
    const { service, sent } = setup(() =>
      Promise.resolve({
        value: { patch: { headers: { Authorization: 'Bearer x' } }, note: 'signed' },
        logs: [],
        envWrites: [],
      }),
    );

    const res = await service.send('t1', { ...REQUEST, actions: [{ ref: 'sign', trigger: 'pre' }] }, {});

    // The header is added, the request's own headers survive.
    expect(sent[0]!.request.headers).toEqual({ A: '1', Authorization: 'Bearer x' });
    // What was sent is reported back, so the Request render tab can show it.
    expect(res.request?.headers?.Authorization).toBe('Bearer x');
    // Everything besides `patch` stays receipt payload.
    expect(res.actions?.[0]?.output).toMatchObject({ note: 'signed' });
  });

  it('ignores a returned value that carries no patch', async () => {
    const { service, sent } = setup(() =>
      Promise.resolve({ value: { headers: { Nope: 'no' } }, logs: [], envWrites: [] }),
    );
    await service.send('t1', { ...REQUEST, actions: [{ ref: 'noisy', trigger: 'pre' }] }, {});

    expect(sent[0]!.request.headers).toEqual({ A: '1' });
  });

  it('does not send at all when a pre action fails', async () => {
    const { service, sent } = setup(() => Promise.reject(new AppError('USER_CODE_FAILED', 'validation', 'boom')));

    await expect(
      service.send('t1', { ...REQUEST, actions: [{ ref: 'sign', trigger: 'pre' }] }, {}),
    ).rejects.toMatchObject({ code: 'REQUEST_ACTION_FAILED' });

    // Sending anyway would surface a puzzling HTTP error instead of the real cause.
    expect(sent).toHaveLength(0);
  });

  it('reports a failing post action without hiding the response', async () => {
    const { service } = setup(() => Promise.reject(new AppError('USER_CODE_FAILED', 'validation', 'boom')));

    const res = await service.send('t1', { ...REQUEST, actions: [{ ref: 'extract', trigger: 'post' }] }, {});

    expect(res.response.status).toBe(200);
    expect(res.actions?.[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('boom') });
  });

  it('skips actions that are disabled', async () => {
    const { service, seen } = setup();
    const res = await service.send(
      't1',
      { ...REQUEST, actions: [{ ref: 'off', trigger: 'pre', enabled: false }] },
      {},
    );

    expect(seen).toHaveLength(0);
    expect(res.actions).toBeUndefined();
  });

  it('surfaces what an action logged and wrote', async () => {
    const { service } = setup(() =>
      Promise.resolve({ value: { ok: true }, logs: ['saved'], envWrites: ['TOKEN'] }),
    );
    const res = await service.send('t1', { ...REQUEST, actions: [{ ref: 'save', trigger: 'post' }] }, {});

    expect(res.actions?.[0]).toMatchObject({ logs: ['saved'], envWrites: ['TOKEN'], status: 'succeeded' });
  });

  it('wraps the request in its folder-inherited actions (pre outside-in, post inside-out)', async () => {
    const order: string[] = [];
    const { service } = setup(
      (ref) => {
        order.push(ref);
        return Promise.resolve({ value: null, logs: [], envWrites: [] });
      },
      [
        { ref: 'folderPre', trigger: 'pre' },
        { ref: 'folderPost', trigger: 'post' },
      ],
    );

    const res = await service.send(
      't1',
      { ...REQUEST, actions: [{ ref: 'ownPre', trigger: 'pre' }, { ref: 'ownPost', trigger: 'post' }] },
      {},
    );

    // Pre: the folder's runs before the request's own; post: the request's own before the folder's.
    expect(order).toEqual(['folderPre', 'ownPre', 'ownPost', 'folderPost']);
    expect(res.actions?.map((a) => a.ref)).toEqual(['folderPre', 'ownPre', 'ownPost', 'folderPost']);
  });

  it('unwinds nested folder post-actions inside-out (the reverse of the pre order)', async () => {
    const order: string[] = [];
    const { service } = setup(
      (ref) => {
        order.push(ref);
        return Promise.resolve({ value: null, logs: [], envWrites: [] });
      },
      // Arrives root→leaf (outermost first), like folderPolicyOf produces.
      [
        { ref: 'rootPre', trigger: 'pre' },
        { ref: 'rootPost', trigger: 'post' },
        { ref: 'leafPre', trigger: 'pre' },
        { ref: 'leafPost', trigger: 'post' },
      ],
    );

    await service.send('t1', REQUEST, {});

    expect(order).toEqual(['rootPre', 'leafPre', 'leafPost', 'rootPost']);
  });

  it('blocks the send when an inherited folder pre-action fails', async () => {
    const { service, sent } = setup(
      () => Promise.reject(new AppError('USER_CODE_FAILED', 'validation', 'boom')),
      [{ ref: 'folderPre', trigger: 'pre' }],
    );

    await expect(service.send('t1', REQUEST, {})).rejects.toMatchObject({
      code: 'REQUEST_ACTION_FAILED',
    });
    expect(sent).toHaveLength(0);
  });

  it('skips a disabled inherited folder action', async () => {
    const { service, seen } = setup(() => Promise.resolve({ value: null, logs: [], envWrites: [] }), [
      { ref: 'off', trigger: 'pre', enabled: false },
    ]);

    await service.send('t1', REQUEST, {});
    expect(seen).toHaveLength(0);
  });

  it('sends a request with no template verbatim, without touching actions', async () => {
    const runAction = vi.fn();
    const { service, sent, history } = setup(runAction as never);

    const res = await service.send(undefined, { ...REQUEST, actions: [{ ref: 'x', trigger: 'pre' }] }, {});

    expect(sent).toHaveLength(1);
    expect(runAction).not.toHaveBeenCalled();
    expect(history).toHaveLength(0);
    expect(res.rendered).toBe(false);
  });
});
