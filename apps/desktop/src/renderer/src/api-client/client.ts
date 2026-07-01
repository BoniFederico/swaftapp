import {
  isError,
  type OpName,
  type OpRequest,
  type OpResponse,
  type ResultEnvelope,
  type SwaftError,
} from '@swaft/shared';
import type { Transport } from './transport/types';
import { IpcTransport } from './transport/ipc';

/**
 * The transport-agnostic API client. Feature code calls `client.call('op.name', payload)` and
 * receives the typed response or throws a typed SwaftError. The transport (IPC today, HTTP later)
 * is injected; feature code never references it. See SWAFT_ARCHITECTURE.md §3.4.
 */
export class ApiError extends Error {
  constructor(public readonly swaft: SwaftError) {
    super(swaft.message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  constructor(private readonly transport: Transport) {}

  async call<N extends OpName>(op: N, payload?: OpRequest<N>): Promise<OpResponse<N>> {
    const result = await this.transport.call(op, payload);
    if (isError(result)) {
      throw new ApiError(result.error);
    }
    return result.data as OpResponse<N>;
  }

  /**
   * Diagnostics/tooling escape hatch: call an arbitrary op string with an arbitrary payload and get
   * the raw result envelope (never throws). Used by the M1 diagnostics panel to exercise the
   * boundary (unknown op / invalid payload). Feature code uses `call`, not `rawCall`.
   */
  rawCall(op: string, payload?: unknown): Promise<ResultEnvelope<unknown>> {
    return this.transport.call(op, payload);
  }
}

/** Default desktop client (IPC transport). */
export const api = new ApiClient(new IpcTransport());
