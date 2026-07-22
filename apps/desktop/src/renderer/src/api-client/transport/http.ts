import type { ResultEnvelope } from '@swaft/shared';
import type { Transport } from './types';

/**
 * Future web transport (stub). Reserved for the limited web app: same op/DTO/error contract over
 * an authenticated HTTP backend hosting the same service layer. Not used on desktop.
 *
 */
export class HttpTransport implements Transport {
  constructor(private readonly baseUrl: string) {}

  async call(op: string, payload?: unknown): Promise<ResultEnvelope<unknown>> {
    const res = await fetch(`${this.baseUrl}/op/${encodeURIComponent(op)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
      credentials: 'include',
    });
    return (await res.json()) as ResultEnvelope<unknown>;
  }
}
