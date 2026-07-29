import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ok, type EnvironmentSummaryDto, type ResultEnvelope } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { EnvironmentProvider } from '../environment/EnvironmentProvider';
import { ExportDialog } from './ExportDialog';

function makeTransport(calls: { op: string; payload: unknown }[]): Transport {
  return {
    call(op, payload): Promise<ResultEnvelope<unknown>> {
      calls.push({ op, payload });
      switch (op) {
        case 'collection.export':
          return Promise.resolve(
            ok({
              files: [{ path: 'Shop.postman_collection.json', content: '{}' }],
              report: ['Skipped 1 document template(s) — no request equivalent.'],
            }),
          );
        case 'file.saveText':
          return Promise.resolve(ok({ path: '/tmp/Shop.postman_collection.json' }));
        default:
          return Promise.resolve(ok({}));
      }
    },
  };
}

describe('ExportDialog', () => {
  it('exports a folder as Postman and saves via file.saveText, defaulting to variabilize', async () => {
    const calls: { op: string; payload: unknown }[] = [];
    const client = new ApiClient(makeTransport(calls));
    render(
      <AppProviders>
        <ExportDialog
          open
          scope={{ kind: 'folder', folderId: 'f1' }}
          defaultName="Orders"
          preview={{ requests: 3, skipped: 1 }}
          client={client}
          onClose={vi.fn()}
        />
      </AppProviders>,
    );

    // scope preview is shown
    expect(screen.getByText(/3 API requests · 1 other templates skipped/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(calls.some((c) => c.op === 'file.saveText')).toBe(true));
    const exportCall = calls.find((c) => c.op === 'collection.export')!;
    expect(exportCall.payload).toEqual({
      scope: { kind: 'folder', folderId: 'f1' },
      format: 'postman',
      conversion: 'variabilize',
      environmentIds: [],
    });
    const saveCall = calls.find((c) => c.op === 'file.saveText')!;
    expect((saveCall.payload as { suggestedName: string }).suggestedName).toBe(
      'Shop.postman_collection.json',
    );
  });

  it('honors the chosen format and conversion', async () => {
    const calls: { op: string; payload: unknown }[] = [];
    const client = new ApiClient(makeTransport(calls));
    render(
      <AppProviders>
        <ExportDialog
          open
          scope={{ kind: 'template', templateId: 't1' }}
          defaultName="Get"
          preview={{ requests: 1, skipped: 0 }}
          client={client}
          onClose={vi.fn()}
        />
      </AppProviders>,
    );

    fireEvent.click(screen.getByLabelText('.http file'));
    fireEvent.click(screen.getByLabelText('Keep verbatim (${ })'));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(calls.some((c) => c.op === 'collection.export')).toBe(true));
    expect(calls.find((c) => c.op === 'collection.export')!.payload).toMatchObject({
      format: 'http',
      conversion: 'verbatim',
    });
  });
});

describe('ExportDialog — environment multi-select (open-standards §3.6)', () => {
  const STAGING: EnvironmentSummaryDto = {
    id: 'e1',
    name: 'Staging',
    description: null,
    ownerKind: 'workspace',
    ownerId: null,
    varCount: 1,
  };
  const PERSONAL: EnvironmentSummaryDto = {
    id: 'e2',
    name: 'My local',
    description: null,
    ownerKind: 'user',
    ownerId: 'fede',
    varCount: 1,
  };

  function makeTransport(calls: { op: string; payload: unknown }[], activeId: string | null): Transport {
    return {
      call(op, payload): Promise<ResultEnvelope<unknown>> {
        calls.push({ op, payload });
        if (op === 'collection.export') {
          return Promise.resolve(ok({ files: [{ path: 'Shop.postman_collection.json', content: '{}' }], report: [] }));
        }
        if (op === 'file.saveText') return Promise.resolve(ok({ path: '/tmp/Shop.postman_collection.json' }));
        if (op === 'env.list') return Promise.resolve(ok({ environments: [STAGING, PERSONAL] }));
        if (op === 'env.selection.get') return Promise.resolve(ok({ environmentId: activeId }));
        return Promise.resolve(ok({}));
      },
    };
  }

  it('defaults the multi-select to the active environment, and flags the personal one', async () => {
    const calls: { op: string; payload: unknown }[] = [];
    const client = new ApiClient(makeTransport(calls, 'e1'));
    render(
      <AppProviders>
        <EnvironmentProvider client={client}>
          <ExportDialog
            open
            scope={{ kind: 'project', projectId: 'p1' }}
            defaultName="Shop"
            preview={null}
            client={client}
            onClose={vi.fn()}
          />
        </EnvironmentProvider>
      </AppProviders>,
    );

    const staging = await screen.findByRole('checkbox', { name: /Staging/ });
    const personal = screen.getByRole('checkbox', { name: /My local/ });
    await waitFor(() => expect(staging).toBeChecked());
    expect(personal).not.toBeChecked();
    expect(screen.getByText('Personal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(calls.some((c) => c.op === 'collection.export')).toBe(true));
    expect(calls.find((c) => c.op === 'collection.export')!.payload).toMatchObject({
      environmentIds: ['e1'],
    });
  });

  it('lets the user add another environment to the bundle', async () => {
    const calls: { op: string; payload: unknown }[] = [];
    const client = new ApiClient(makeTransport(calls, null));
    render(
      <AppProviders>
        <EnvironmentProvider client={client}>
          <ExportDialog
            open
            scope={{ kind: 'project', projectId: 'p1' }}
            defaultName="Shop"
            preview={null}
            client={client}
            onClose={vi.fn()}
          />
        </EnvironmentProvider>
      </AppProviders>,
    );

    const personal = await screen.findByRole('checkbox', { name: /My local/ });
    fireEvent.click(personal);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(calls.some((c) => c.op === 'collection.export')).toBe(true));
    expect(calls.find((c) => c.op === 'collection.export')!.payload).toMatchObject({
      environmentIds: ['e2'],
    });
  });
});
