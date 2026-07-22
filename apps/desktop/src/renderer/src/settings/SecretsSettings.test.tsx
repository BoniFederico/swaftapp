import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ok, type ResultEnvelope } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { SecretsSettings } from './sections/SecretsSettings';

/** A fake secrets store: keychain values never cross the wire, only the sorted names do. */
function makeTransport(initial: Record<string, string>): { transport: Transport; store: Record<string, string> } {
  const store = { ...initial };
  const refs = () => Object.keys(store).sort();
  const transport: Transport = {
    call(op, payload): Promise<ResultEnvelope<unknown>> {
      if (op === 'secret.list') return Promise.resolve(ok({ refs: refs() }));
      if (op === 'secret.set') {
        const r = payload as { ref: string; value: string };
        store[r.ref] = r.value;
        return Promise.resolve(ok({ refs: refs() }));
      }
      if (op === 'secret.delete') {
        delete store[(payload as { ref: string }).ref];
        return Promise.resolve(ok({ refs: refs() }));
      }
      return Promise.resolve(ok({}));
    },
  };
  return { transport, store };
}

function renderSection(initial: Record<string, string> = {}) {
  const { transport, store } = makeTransport(initial);
  render(
    <AppProviders>
      <SecretsSettings client={new ApiClient(transport)} />
    </AppProviders>,
  );
  return store;
}

describe('SecretsSettings', () => {
  it('lists stored secret names and their reference syntax', async () => {
    renderSection({ API_TOKEN: 'x', DB_PASS: 'y' });
    expect(await screen.findByText('API_TOKEN')).toBeInTheDocument();
    expect(screen.getByText('DB_PASS')).toBeInTheDocument();
    // The reference hint is shown so users know how to use it.
    expect(screen.getByText("${ secret('API_TOKEN') }")).toBeInTheDocument();
  });

  it('adds a secret (name + value) and stores it in the keychain', async () => {
    const store = renderSection();
    fireEvent.change(screen.getByLabelText(/secret name/i), { target: { value: 'API_TOKEN' } });
    fireEvent.change(screen.getByLabelText(/^value$/i), { target: { value: 's3cret' } });
    fireEvent.click(screen.getByRole('button', { name: /add secret/i }));

    await waitFor(() => expect(store.API_TOKEN).toBe('s3cret'));
    expect(await screen.findByText('API_TOKEN')).toBeInTheDocument();
  });

  it('deletes a secret', async () => {
    const store = renderSection({ API_TOKEN: 'x' });
    await screen.findByText('API_TOKEN');
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect('API_TOKEN' in store).toBe(false));
  });
});
