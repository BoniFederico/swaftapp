import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ok, type EnvironmentDto, type ResultEnvelope } from '@swaft/shared';
import { AppProviders } from '../../AppProviders';
import { ApiClient } from '../../api-client/client';
import type { Transport } from '../../api-client/transport/types';
import { EnvironmentProvider } from '../../environment/EnvironmentProvider';
import { EnvironmentsSettings } from './EnvironmentsSettings';

const BASE: EnvironmentDto = {
  id: 'e1',
  name: 'Staging',
  description: null,
  ownerKind: 'workspace',
  ownerId: null,
  varCount: 1,
  vars: { TOKEN: 'abc' },
  secretVars: [],
};

function makeTransport(calls: { op: string; payload: unknown }[], env: EnvironmentDto): Transport {
  return {
    call(op, payload): Promise<ResultEnvelope<unknown>> {
      calls.push({ op, payload: payload ?? null });
      if (op === 'env.get') return Promise.resolve(ok({ environment: env }));
      if (op === 'env.update') return Promise.resolve(ok({ environment: env }));
      if (op === 'env.list') return Promise.resolve(ok({ environments: [env] }));
      if (op === 'env.selection.get') return Promise.resolve(ok({ environmentId: null }));
      return Promise.resolve(ok({}));
    },
  };
}

describe('EnvironmentsSettings — secret label', () => {
  it('toggles a variable to secret and saves it in the env.update payload', async () => {
    const calls: { op: string; payload: unknown }[] = [];
    const client = new ApiClient(makeTransport(calls, BASE));

    render(
      <AppProviders>
        <EnvironmentProvider client={client}>
          <EnvironmentsSettings
            client={client}
            selectedId="e1"
            creating={false}
            onSelect={vi.fn()}
            onCancelCreate={vi.fn()}
            onDeleted={vi.fn()}
          />
        </EnvironmentProvider>
      </AppProviders>,
    );

    await screen.findByDisplayValue('TOKEN');
    fireEvent.click(screen.getByRole('button', { name: /Mark as secret/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls.some((c) => c.op === 'env.update')).toBe(true));
    const update = calls.find((c) => c.op === 'env.update')!;
    expect((update.payload as { secretVars: string[] }).secretVars).toEqual(['TOKEN']);
  });

  it('masks a secret-labeled value as a password field', async () => {
    const calls: { op: string; payload: unknown }[] = [];
    const secretEnv: EnvironmentDto = { ...BASE, secretVars: ['TOKEN'] };
    const client = new ApiClient(makeTransport(calls, secretEnv));

    render(
      <AppProviders>
        <EnvironmentProvider client={client}>
          <EnvironmentsSettings
            client={client}
            selectedId="e1"
            creating={false}
            onSelect={vi.fn()}
            onCancelCreate={vi.fn()}
            onDeleted={vi.fn()}
          />
        </EnvironmentProvider>
      </AppProviders>,
    );

    const value = await screen.findByDisplayValue('abc');
    expect(value).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: /Mark as config/ })).toBeInTheDocument();
  });
});
