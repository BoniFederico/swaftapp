import { afterEach, describe, expect, it } from 'vitest';
import { ok, makeError, type ResultEnvelope } from '@swaft/shared';
import { ApiClient, ApiError } from './client';
import { IpcTransport } from './transport/ipc';
import type { Transport } from './transport/types';

function transportReturning(result: ResultEnvelope<unknown>): Transport {
  return { call: () => Promise.resolve(result) };
}

describe('ApiClient', () => {
  it('unwraps the data envelope', async () => {
    const client = new ApiClient(transportReturning(ok({ pong: true, echo: '', ts: '' })));
    const res = await client.call('system.ping', {});
    expect(res.pong).toBe(true);
  });

  it('throws a typed ApiError carrying the coded envelope error', async () => {
    const client = new ApiClient(
      transportReturning(makeError('NO_SESSION', 'auth', 'Authentication required')),
    );
    const err = await client.call('system.ping', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).swaft.code).toBe('NO_SESSION');
    expect((err as ApiError).message).toBe('Authentication required');
  });

  it('rawCall returns the raw envelope without throwing', async () => {
    const client = new ApiClient(transportReturning(makeError('UNKNOWN_OP', 'not_found', 'nope')));
    const raw = await client.rawCall('anything');
    expect('error' in raw && raw.error.code).toBe('UNKNOWN_OP');
  });
});

describe('IpcTransport', () => {
  const g = globalThis as { swaft?: { invoke: (op: string, p?: unknown) => Promise<unknown> } };

  afterEach(() => {
    delete g.swaft;
  });

  it('returns a NO_BRIDGE error envelope when the preload bridge is missing', async () => {
    delete g.swaft;
    const result = await new IpcTransport().call('system.ping');
    expect('error' in result && result.error.code).toBe('NO_BRIDGE');
  });

  it('forwards op and payload through the bridge and returns its envelope', async () => {
    const seen: unknown[] = [];
    g.swaft = {
      invoke: (op, payload) => {
        seen.push(op, payload);
        return Promise.resolve(ok({ pong: true }));
      },
    };
    const result = await new IpcTransport().call('system.ping', { echo: 'x' });
    expect(seen).toEqual(['system.ping', { echo: 'x' }]);
    expect('data' in result && (result.data as { pong: boolean }).pong).toBe(true);
  });
});
