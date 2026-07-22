import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ok, type ResultEnvelope } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
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
