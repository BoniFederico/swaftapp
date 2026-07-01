import type { ResultEnvelope } from '@swaft/shared';

/**
 * Transport interface. The renderer's API client is transport-agnostic: on desktop it uses the
 * IPC transport (preload bridge); a future web app swaps in an HTTP transport with the SAME
 * op/DTO/error contract. Feature code must never touch a transport directly.
 * See SWAFT_ARCHITECTURE.md §3.4 (TR-1..TR-3), §12.
 */
export interface Transport {
  call(op: string, payload?: unknown): Promise<ResultEnvelope<unknown>>;
}
