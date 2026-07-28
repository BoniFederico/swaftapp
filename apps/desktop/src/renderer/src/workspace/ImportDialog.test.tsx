import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AppProviders } from '../AppProviders';
import { ImportDialog } from './ImportDialog';

const postman = JSON.stringify({
  info: { name: 'Shop', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    {
      name: 'Orders',
      item: [{ name: 'Get order', request: { method: 'GET', url: 'https://{{base}}/orders/{{id}}' } }],
    },
  ],
  variable: [{ key: 'base', value: 'https://api.shop.io' }],
});

describe('ImportDialog', () => {
  it('parses a pasted Postman collection, previews it, and imports into a named project', async () => {
    const onImport = vi.fn();
    render(
      <AppProviders>
        <ImportDialog open onImport={onImport} onClose={vi.fn()} />
      </AppProviders>,
    );

    fireEvent.change(screen.getByPlaceholderText(/Paste an OpenAPI or Postman/), {
      target: { value: postman },
    });

    // preview appears once the async parse resolves
    await waitFor(() =>
      expect(screen.getByText(/Postman: 1 requests · 1 folders · 1 environments/)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const [collection, projectName] = onImport.mock.calls[0];
    expect(projectName).toBe('Shop');
    expect(collection.requests).toHaveLength(1);
    // Postman {{var}} was translated to Seebo ${ var } at the import boundary
    expect(collection.requests[0].request.url).toBe('https://${ base }/orders/${ id }');
    expect(collection.requests[0].folderPath).toEqual(['Orders']);
  });

  it('rejects an unrecognized format', async () => {
    render(
      <AppProviders>
        <ImportDialog open onImport={vi.fn()} onClose={vi.fn()} />
      </AppProviders>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste an OpenAPI or Postman/), {
      target: { value: '{"hello":"world"}' },
    });
    await waitFor(() => expect(screen.getByText(/Unrecognized format/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });
});
