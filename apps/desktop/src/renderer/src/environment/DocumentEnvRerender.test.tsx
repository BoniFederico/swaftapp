import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ok, type EnvironmentSummaryDto, type ResultEnvelope } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { DocumentView } from '../document/DocumentView';
import { EnvironmentPicker } from './EnvironmentPicker';
import { EnvironmentProvider } from './EnvironmentProvider';

const ENVS: EnvironmentSummaryDto[] = [
  { id: 'dev', name: 'Dev', description: null, ownerKind: 'workspace', ownerId: null, ownerName: null, varCount: 1 },
  { id: 'prod', name: 'Prod', description: null, ownerKind: 'workspace', ownerId: null, ownerName: null, varCount: 1 },
];
const GREETING: Record<string, string> = { dev: 'Hi', prod: 'Ciao' };

const template = {
  id: 't1',
  folderId: null,
  projectId: 'p1',
  name: 'Greet',
  type: 'document' as const,
  subtype: 'text',
  tagIds: [] as string[],
  method: null,
  source: "${ env({ id:'greeting', type:string() }) }",
  hasDraft: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/**
 * A fake transport that mimics the backend just enough for DocumentView: `template.render` resolves
 * the greeting from the *active* environment (like the real `env(...)` capability would), so switching
 * the active environment must produce a different rendered output.
 */
function makeTransport(state: { activeId: string | null }): Transport {
  return {
    call(op, payload): Promise<ResultEnvelope<unknown>> {
      switch (op) {
        case 'template.get':
          return Promise.resolve(ok({ template }));
        case 'release.list':
          return Promise.resolve(ok({ releases: [] }));
        case 'releaseSelection.get':
          return Promise.resolve(ok({ releaseId: 'draft' }));
        case 'inputState.get':
          return Promise.resolve(ok({ values: {} }));
        case 'render.analyzeSource':
          return Promise.resolve(ok({ requirements: [] }));
        case 'template.render':
          return Promise.resolve(
            ok({
              result: {
                status: 'completed',
                output: GREETING[state.activeId ?? 'dev'] ?? '',
                pending: [],
                diagnostics: [],
                actions: [],
                resolved: ['greeting'],
              },
            }),
          );
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

describe('DocumentView — re-renders on active environment change', () => {
  it('re-renders in place when the environment is switched from the header picker', async () => {
    const state = { activeId: 'dev' as string | null };
    const client = new ApiClient(makeTransport(state));
    render(
      <AppProviders>
        <EnvironmentProvider client={client}>
          <EnvironmentPicker onManage={() => {}} />
          <DocumentView client={client} templateId="t1" />
        </EnvironmentProvider>
      </AppProviders>,
    );

    // Rendered from the active "Dev" environment.
    expect(await screen.findByText('Hi', {}, { timeout: 4000 })).toBeInTheDocument();

    // Switch to "Prod" via the header picker — the open document re-renders without a reopen.
    fireEvent.click(await screen.findByRole('button', { name: 'Active environment' }));
    fireEvent.click(await screen.findByText('Prod'));
    expect(await screen.findByText('Ciao', {}, { timeout: 4000 })).toBeInTheDocument();
  });
});
