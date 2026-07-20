import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isError, type ResultEnvelope } from '@swaft/shared';

type InvokeHandler = (event: unknown, op: unknown, payload: unknown) => Promise<ResultEnvelope<unknown>>;
const registered = new Map<string, InvokeHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: InvokeHandler) => {
      registered.set(channel, fn);
    },
  },
}));

import { IPC_INVOKE_CHANNEL } from './channels';
import { registerIpcRouter } from './router';

/** The security layers the router itself owns: sender trust and the op allow-list (IPC-3/IPC-4). */
describe('ipc router', () => {
  const trustedSender = { id: 'main-window' };

  function invoke(sender: unknown, op: unknown, payload?: unknown) {
    const handler = registered.get(IPC_INVOKE_CHANNEL);
    if (!handler) throw new Error('router did not register the invoke channel');
    return handler({ sender }, op, payload);
  }

  beforeEach(() => {
    registered.clear();
    registerIpcRouter((sender) => (sender as unknown) === trustedSender);
  });

  it('rejects an untrusted sender before doing anything else', async () => {
    const result = await invoke({ id: 'not-our-window' }, 'system.ping', {});
    expect(isError(result) && result.error.code).toBe('FORBIDDEN_SENDER');
  });

  it('rejects non-string and non-allow-listed ops', async () => {
    const bad = await invoke(trustedSender, 42, {});
    expect(isError(bad) && bad.error.code).toBe('UNKNOWN_OP');

    const unknown = await invoke(trustedSender, 'not.a.real.op', {});
    expect(isError(unknown) && unknown.error.code).toBe('UNKNOWN_OP');
  });

  it('delegates an allowed public op to dispatch (full path: validate → handler)', async () => {
    const result = await invoke(trustedSender, 'system.ping', { echo: 'hello' });
    expect(isError(result)).toBe(false);
    const data = (result as { data: { pong: boolean; echo: string } }).data;
    expect(data.pong).toBe(true);
    expect(data.echo).toBe('hello');
  });

  it('fails closed on session-required ops when no session gate is signed in', async () => {
    const result = await invoke(trustedSender, 'workspace.create', {
      name: 'X',
      location: 'mem://x.swaft',
      encrypt: false,
    });
    expect(isError(result) && result.error.code).toBe('NO_SESSION');
  });
});
