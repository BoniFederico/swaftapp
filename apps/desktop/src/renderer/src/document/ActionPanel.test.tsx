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
  it('reveals the performed action’s output and logs, expanded after the run', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm action g' }));
    fireEvent.click(screen.getByRole('button', { name: 'Perform actions' }));

    // The fresh run auto-expands, so the output is visible without a click.
    await waitFor(() => expect(screen.getByText('hello world')).toBeInTheDocument());
    expect(screen.getByText('greeting world')).toBeInTheDocument();
    expect(screen.getByText(/Wrote TOKEN/)).toBeInTheDocument();
  });

  it('collapses and re-expands the detail on click', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm action g' }));
    fireEvent.click(screen.getByRole('button', { name: 'Perform actions' }));
    await waitFor(() => expect(screen.getByText('hello world')).toBeInTheDocument());

    // The receipt line is a button; toggling it hides then shows the detail again.
    const row = screen.getByRole('button', { expanded: true });
    fireEvent.click(row);
    await waitFor(() => expect(screen.queryByText('hello world')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    await waitFor(() => expect(screen.getByText('hello world')).toBeInTheDocument());
  });
});
