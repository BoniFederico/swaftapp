import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toArazzo } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { ImportArazzoDialog } from './ImportArazzoDialog';

const graph = {
  version: 1 as const,
  nodes: [
    { id: 'start', kind: 'start' as const, position: { x: 0, y: 0 } },
    {
      id: 'n1',
      kind: 'template' as const,
      templateType: 'api' as const,
      ref: 'known-template',
      position: { x: 100, y: 0 },
    },
    {
      id: 'n2',
      kind: 'template' as const,
      templateType: 'action' as const,
      ref: 'missing-template',
      position: { x: 200, y: 0 },
    },
  ],
  edges: [
    { id: 'e0', from: 'start', to: 'n1' },
    { id: 'e1', from: 'n1', to: 'n2' },
  ],
};

describe('ImportArazzoDialog', () => {
  it('parses a pasted Arazzo document, previews it, and flags an unresolved template ref', async () => {
    const onImport = vi.fn();
    const yamlDoc = JSON.stringify(toArazzo('Login flow', graph));
    render(
      <AppProviders>
        <ImportArazzoDialog
          open
          scenarioName="Login flow"
          existingTemplateIds={new Set(['known-template'])}
          onImport={onImport}
          onClose={vi.fn()}
        />
      </AppProviders>,
    );

    fireEvent.change(screen.getByPlaceholderText(/Paste an Arazzo/), { target: { value: yamlDoc } });

    await waitFor(() => expect(screen.getByText(/3 nodes · 2 edges/)).toBeInTheDocument());
    expect(screen.getByText(/1 step\(s\) reference a template not in this workspace: missing-template/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const [importedGraph] = onImport.mock.calls[0];
    expect(importedGraph.nodes).toHaveLength(3);
  });

  it('rejects content with no workflow steps', async () => {
    render(
      <AppProviders>
        <ImportArazzoDialog
          open
          scenarioName="Login flow"
          existingTemplateIds={new Set()}
          onImport={vi.fn()}
          onClose={vi.fn()}
        />
      </AppProviders>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste an Arazzo/), {
      target: { value: '{"hello":"world"}' },
    });
    await waitFor(() => expect(screen.getByText(/No workflow steps found/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });
});
