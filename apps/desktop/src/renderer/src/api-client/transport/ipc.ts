import type { ResultEnvelope } from '@swaft/shared';
import type { Transport } from './types';

/** Desktop transport: routes ops through the preload `window.swaft.invoke` bridge. */
export class IpcTransport implements Transport {
  async call(op: string, payload?: unknown): Promise<ResultEnvelope<unknown>> {
    const bridge = (globalThis as unknown as { swaft?: { invoke: (op: string, p?: unknown) => Promise<unknown> } })
      .swaft;
    if (!bridge) {
      return {
        error: {
          code: 'NO_BRIDGE',
          category: 'internal',
          message: 'Preload bridge unavailable (window.swaft missing)',
        },
      };
    }
    return (await bridge.invoke(op, payload)) as ResultEnvelope<unknown>;
  }
}
