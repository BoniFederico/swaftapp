import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ok, type EnvironmentSummaryDto, type ResultEnvelope } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { EnvironmentProvider } from './EnvironmentProvider';
import { EnvironmentPicker } from './EnvironmentPicker';

const ENVS: EnvironmentSummaryDto[] = [
  { id: 'e1', name: 'Staging', description: null, ownerKind: 'workspace', ownerId: null, varCount: 2 },
  { id: 'e2', name: 'My Local', description: null, ownerKind: 'user', ownerId: 'alice', varCount: 1 },
];

/** Fake transport for the env ops; records the last selection set. */
function makeTransport(state: { activeId: string | null }): Transport {
  return {
    call(op, payload): Promise<ResultEnvelope<unknown>> {
      switch (op) {
        case 'env.list':
          return Promise.resolve(ok({ environments: ENVS }));
        case 'env.selection.get':
          return Promise.resolve(ok({ environmentId: state.activeId }));
        case 'env.selection.set':
          state.activeId = (payload as { environmentId: string | null }).environmentId;
          return Promise.resolve(ok({ environmentId: state.activeId }));
        default:
          return Promise.resolve(ok({}));
      }
    },
  };
}

function renderPicker(onManage = vi.fn(), activeId: string | null = null) {
  const state = { activeId };
  render(
    <AppProviders>
      <EnvironmentProvider client={new ApiClient(makeTransport(state))}>
        <EnvironmentPicker onManage={onManage} />
      </EnvironmentProvider>
    </AppProviders>,
  );
  return { onManage, state };
}

describe('EnvironmentPicker', () => {
  it('shows the placeholder, then lists environments with ownership badges', async () => {
    renderPicker();
    const trigger = await screen.findByRole('button', { name: 'Active environment' });
    expect(trigger).toHaveTextContent('Select environment');

    fireEvent.click(trigger);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('Staging')).toBeInTheDocument();
    expect(screen.getByText('My Local')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Personal')).toBeInTheDocument();
  });

  it('selecting an environment makes it active (persists + updates the trigger)', async () => {
    const { state } = renderPicker();
    fireEvent.click(await screen.findByRole('button', { name: 'Active environment' }));
    fireEvent.click(await screen.findByText('Staging'));
    await waitFor(() => expect(state.activeId).toBe('e1'));
    expect(screen.getByRole('button', { name: 'Active environment' })).toHaveTextContent('Staging');
  });

  it('invokes onManage from "Manage environments…"', async () => {
    const { onManage } = renderPicker();
    fireEvent.click(await screen.findByRole('button', { name: 'Active environment' }));
    fireEvent.click(await screen.findByText('Manage environments…'));
    expect(onManage).toHaveBeenCalledOnce();
  });
});
