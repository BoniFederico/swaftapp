import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ok, type ActionSummaryDto, type ReceiptDto, type ResultEnvelope } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { ActionPanel } from './ActionPanel';

const ACTIONS: ActionSummaryDto[] = [
  { id: 'g', type: 'greet', environment: 'test', requiresConfirmation: true, status: 'pendingConfirmation' },
];

/** A performed receipt carrying the output + logs the action produced. */
const PERFORMED: ReceiptDto = {
  id: 'r1',
  actionId: 'g',
  actionType: 'greet',
  status: 'succeeded',
  message: 'ok',
  environment: 'test',
  createdAt: '2026-07-20T00:00:00Z',
  output: 'hello world',
  logs: ['greeting world'],
  envWrites: ['TOKEN'],
};

function makeTransport(): Transport {
  return {
    call(op): Promise<ResultEnvelope<unknown>> {
      if (op === 'receipt.list') return Promise.resolve(ok({ receipts: [] }));
      if (op === 'action.execute') return Promise.resolve(ok({ receipts: [PERFORMED] }));
      return Promise.resolve(ok({}));
    },
  };
}

function renderPanel() {
  render(
    <AppProviders>
      <ActionPanel client={new ApiClient(makeTransport())} templateId="t1" actions={ACTIONS} />
    </AppProviders>,
  );
}

describe('ActionPanel', () => {
  it('runs an action and auto-opens its run detail (output, logs, env writes)', async () => {
    renderPanel();
    // One Run button per prepared action; pressing it performs that action.
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    // The fresh run auto-opens its detail popup, so the output is one glance away.
    await waitFor(() => expect(screen.getByText('hello world')).toBeInTheDocument());
    expect(screen.getByText('greeting world')).toBeInTheDocument();
    expect(screen.getByText(/Wrote TOKEN/)).toBeInTheDocument();
  });

  it('lists the run in the action history and reopens the detail on click', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByText('hello world')).toBeInTheDocument());

    // Close the popup → the run stays listed under its action.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('hello world')).not.toBeInTheDocument());

    // Clicking the history row reopens the detail popup.
    fireEvent.click(screen.getByRole('button', { name: /succeeded/ }));
    await waitFor(() => expect(screen.getByText('hello world')).toBeInTheDocument());
  });
});
