import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ok, type ResultEnvelope } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { WorkspaceProvider } from '../workspace/WorkspaceProvider';
import { CloneDialog } from './CloneDialog';

const GIT_SUMMARY = {
  name: 'Cloned WS',
  icon: null,
  path: '/dest/ws',
  storageMode: 'git' as const,
  executionMode: 'sandbox' as const,
  encrypted: false,
};

function makeTransport(calls: { op: string; payload: unknown }[]): Transport {
  return {
    call(op, payload): Promise<ResultEnvelope<unknown>> {
      calls.push({ op, payload });
      switch (op) {
        case 'dialog.pickDirectory':
          return Promise.resolve(ok({ path: '/dest' }));
        case 'git.clone':
          return Promise.resolve(ok({ workspace: GIT_SUMMARY }));
        case 'workspace.current':
          return Promise.resolve(ok({ workspace: GIT_SUMMARY }));
        case 'workspace.recent':
          return Promise.resolve(ok({ items: [] }));
        default:
          return Promise.resolve(ok({}));
      }
    },
  };
}

describe('CloneDialog', () => {
  it('clones a URL into a chosen folder, then opens the workspace', async () => {
    const calls: { op: string; payload: unknown }[] = [];
    const client = new ApiClient(makeTransport(calls));
    render(
      <AppProviders>
        <WorkspaceProvider client={client}>
          <CloneDialog open onClose={vi.fn()} />
        </WorkspaceProvider>
      </AppProviders>,
    );

    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: 'https://example.test/acme/ws.git' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
    await waitFor(() => expect(screen.getByTestId('clone-parent')).toHaveTextContent('/dest'));

    fireEvent.click(screen.getByRole('button', { name: 'Clone' }));

    await waitFor(() => expect(calls.some((c) => c.op === 'git.clone')).toBe(true));
    expect(calls.find((c) => c.op === 'git.clone')?.payload).toEqual({
      url: 'https://example.test/acme/ws.git',
      parentDir: '/dest',
    });
  });
});
