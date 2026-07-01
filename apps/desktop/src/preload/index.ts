import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload bridge. Exposes ONLY a minimal typed `invoke(op, payload)` over contextBridge.
 * Raw ipcRenderer is never exposed. All renderer→main calls funnel through the single
 * allow-listed channel; the main-process router enforces the op allow-list + sender check.
 * See SWAFT_SECURITY_MODEL.md §3 (IPC-2) and SWAFT_ARCHITECTURE.md §2.3, §5.
 */

const IPC_INVOKE_CHANNEL = 'swaft:invoke';

const api = {
  invoke(op: string, payload?: unknown): Promise<unknown> {
    return ipcRenderer.invoke(IPC_INVOKE_CHANNEL, op, payload);
  },
};

contextBridge.exposeInMainWorld('swaft', api);

export type SwaftBridge = typeof api;
