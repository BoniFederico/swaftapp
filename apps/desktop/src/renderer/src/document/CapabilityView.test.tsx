import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ok, type ResultEnvelope } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { CapabilityView } from './CapabilityView';

const SOURCE = `export default () => ({ ok: true });`;

function makeTransport(calls: string[]): Transport {
  return {
    call(op): Promise<ResultEnvelope<unknown>> {
      calls.push(op);
      if (op === 'template.get') {
        return Promise.resolve(ok({ template: { id: 't1', name: 'cfg', source: SOURCE } }));
      }
      if (op === 'usercode.describe') {
        return Promise.resolve(
          ok({ capability: { name: 'cfg', type: 'object', status: 'ok', message: null } }),
        );
      }
      return Promise.resolve(ok({}));
    },
  };
}

/**
 * Mirrors WorkspaceView: a stable client, but callback props rebuilt on every render (that is what
 * WorkspaceView does), plus a button to force one.
 */
function Host({ client }: { client: ApiClient }) {
  const [, force] = useState(0);
  return (
    <AppProviders>
      <button onClick={() => force((n) => n + 1)}>rerender</button>
      <CapabilityView
        client={client}
        templateId="t1"
        onDirtyChange={() => force((n) => n + 1)}
        onTitleChange={() => undefined}
      />
    </AppProviders>
  );
}

describe('CapabilityView', () => {
  it('does not reload the source when the parent re-renders with new callbacks', async () => {
    const calls: string[] = [];
    render(<Host client={new ApiClient(makeTransport(calls))} />);
    await waitFor(() => expect(calls.filter((c) => c === 'template.get')).toHaveLength(1));

    // A parent re-render used to restart the load effect, which overwrote whatever was being typed.
    fireEvent.click(screen.getByRole('button', { name: 'rerender' }));
    fireEvent.click(screen.getByRole('button', { name: 'rerender' }));

    await waitFor(() => expect(screen.getByText('cfg')).toBeInTheDocument());
    expect(calls.filter((c) => c === 'template.get')).toHaveLength(1);
  });

  it('shows the name it is registered under and how to call it', async () => {
    const calls: string[] = [];
    render(<Host client={new ApiClient(makeTransport(calls))} />);

    await waitFor(() => expect(screen.getByText('cfg')).toBeInTheDocument());
    expect(screen.getByText(/\$\{ cfg\(\{ id: 'demo' \}\) \}/)).toBeInTheDocument();
  });
});
