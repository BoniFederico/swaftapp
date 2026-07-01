import { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ResultEnvelope } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { dispatch } from '../../../main/transport/dispatch';
import { setSessionGate } from '../../../main/transport/session';
import { getOrganizationService, getTemplateService } from '../../../main/services';
import {
  installTestWorkspaceBackend,
  resetTestWorkspaceBackend,
} from '../../../main/workspace/testing';
import { WorkingTree } from '../workspace/WorkingTree';
import { BatchDocumentView } from './BatchDocumentView';
import { BatcherView, type BatchItem } from './BatcherView';

/**
 * The Batcher is controlled (its parent owns the batch list) and "Load inputs" opens the merged
 * inputs in the main area — a harness mirroring how WorkspaceView wires it together.
 */
function BatcherHarness() {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [batch, setBatch] = useState<string[] | null>(null);
  return (
    <>
      <BatcherView items={items} onItemsChange={setItems} onLoadInputs={setBatch} />
      {batch && <BatchDocumentView client={client} templateIds={batch} />}
    </>
  );
}

class DispatchTransport implements Transport {
  call(op: string, payload?: unknown): Promise<ResultEnvelope<unknown>> {
    return dispatch(op, payload);
  }
}
const client = new ApiClient(new DispatchTransport());

/** A minimal DataTransfer stand-in so dragStart→drop can carry the template payload in jsdom. */
function makeDataTransfer() {
  const store = new Map<string, string>();
  return {
    setData: (k: string, v: string) => store.set(k, v),
    getData: (k: string) => store.get(k) ?? '',
    dropEffect: '',
    effectAllowed: '',
  };
}

describe('Batcher (drag-and-drop)', () => {
  beforeEach(() => setSessionGate({ isSignedIn: () => true }));
  afterEach(() => {
    setSessionGate({ isSignedIn: () => false });
    resetTestWorkspaceBackend();
  });

  it('starts empty and builds a batch by dragging document templates in', async () => {
    const { workspace } = installTestWorkspaceBackend();
    await workspace.create({ name: 'WS', location: 'mem://b.swaft', encrypt: false });
    const org = getOrganizationService();
    let tree = await org.createProject({ name: 'P' });
    tree = await org.createFolder({ name: 'F', projectId: tree.projects[0]!.id });
    const folderId = tree.folders[0]!.id;
    const templates = getTemplateService();
    await templates.createTemplate({
      folderId,
      name: 'Alpha',
      type: 'document',
      source: "A:${ textbox({ id:'name', type:string() }) }",
    });
    await templates.createTemplate({
      folderId,
      name: 'Beta',
      type: 'document',
      source: "B:${ textbox({ id:'name', type:string() }) }",
    });

    render(
      <AppProviders>
        <WorkingTree
          client={client}
          openTemplateId={null}
          onOpenTemplate={() => {}}
          onCollapse={() => {}}
        />
        <BatcherHarness />
      </AppProviders>,
    );

    // The batch starts empty.
    const drop = screen.getByTestId('batch-drop');
    expect(within(drop).getByText(/Drag document templates here/i)).toBeInTheDocument();

    // Reveal the templates in the tree (clicking a folder row expands it).
    fireEvent.click(await screen.findByRole('button', { name: 'Select project' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'P' }));
    fireEvent.click((await screen.findByText('F')).closest('.tree-item')!);

    // Drag both templates into the drop zone.
    for (const name of ['Alpha', 'Beta']) {
      const row = (await screen.findByText(name)).closest('.tree-item')!;
      const data = makeDataTransfer();
      fireEvent.dragStart(row, { dataTransfer: data });
      fireEvent.drop(drop, { dataTransfer: data });
    }
    expect(within(drop).getByText('Alpha')).toBeInTheDocument();
    expect(within(drop).getByText('Beta')).toBeInTheDocument();

    // Load the shared input once, then render the composite.
    fireEvent.click(screen.getByRole('button', { name: 'Load inputs' }));
    fireEvent.change(await screen.findByLabelText('name'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Render batch' }));

    await waitFor(() => {
      const out = screen.getByTestId('batch-output').textContent ?? '';
      expect(out).toContain('A:Ada');
      expect(out).toContain('B:Ada');
    });
  });
});
