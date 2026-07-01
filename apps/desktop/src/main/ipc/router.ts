import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { makeError, type ResultEnvelope } from '@swaft/shared';
import { IPC_INVOKE_CHANNEL, isAllowedOp } from './channels';
import { dispatch } from '../transport/dispatch';

/**
 * The thin IPC router. It enforces:
 *  - a single allow-listed channel + op allow-list (channels.ts),
 *  - a sender-frame check (only the app's own window may call),
 *  - delegation to the transport-agnostic dispatcher (no business logic here).
 * DTO schema validation and the session guard are layered in M1/M3.
 * See SWAFT_ARCHITECTURE.md §5, SWAFT_SECURITY_MODEL.md §3 (IPC-1..IPC-9).
 */

type SenderCheck = (sender: WebContents) => boolean;

export function registerIpcRouter(isTrustedSender: SenderCheck): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNEL,
    async (event: IpcMainInvokeEvent, op: unknown, payload: unknown): Promise<ResultEnvelope<unknown>> => {
      // Sender-frame check (IPC-4): reject anything that is not our own window.
      if (!isTrustedSender(event.sender)) {
        return makeError('FORBIDDEN_SENDER', 'auth', 'Untrusted IPC sender');
      }
      // Op allow-list (IPC-3).
      if (typeof op !== 'string' || !isAllowedOp(op)) {
        return makeError('UNKNOWN_OP', 'not_found', `Op not allowed: ${String(op)}`);
      }
      return dispatch(op, payload);
    },
  );
}
