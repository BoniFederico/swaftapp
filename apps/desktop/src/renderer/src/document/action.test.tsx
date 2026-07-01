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
import { DocumentView } from './DocumentView';

class DispatchTransport implements Transport {
  call(op: string, payload?: unknown): Promise<ResultEnvelope<unknown>> {
    return dispatch(op, payload);
  }
}
const client = new ApiClient(new DispatchTransport());

const ACTION_SOURCE =
  "start ${ action({ id:'mk', type:'log', input:{ x:'hi' }, confirm:true, environment:'test' }) }";

describe('Action Panel (M10)', () => {
  beforeEach(() => setSessionGate({ isSignedIn: () => true }));
  afterEach(() => {
    setSessionGate({ isSignedIn: () => false });
    resetTestWorkspaceBackend();
  });

  it('confirms and performs a prepared action, then shows a receipt', async () => {
    const { workspace } = installTestWorkspaceBackend();
    await workspace.create({ name: 'WS', location: 'mem://a.swaft', encrypt: false });
    const org = getOrganizationService();
    let tree = await org.createProject({ name: 'P' });
    tree = await org.createFolder({ name: 'F', projectId: tree.projects[0]!.id });
    const folderId = tree.folders[0]!.id;
    const res = await getTemplateService().createTemplate({
      folderId,
      name: 'Doc',
      type: 'document',
      source: ACTION_SOURCE,
    });
    const id = res.templates.find((x) => x.name === 'Doc')!.id;

    render(
      <AppProviders>
        <DocumentView client={client} templateId={id} />
      </AppProviders>,
    );

    // Auto-render (no Render button) → the Action Panel appears with the prepared action.
    const confirm = await screen.findByLabelText('Confirm action mk');

    // Performing without confirming would skip; confirm first, then perform.
    fireEvent.click(confirm);
    fireEvent.click(screen.getByRole('button', { name: 'Perform actions' }));

    await waitFor(() =>
      expect(within(screen.getByTestId('action-receipts')).getByText('succeeded')).toBeInTheDocument(),
    );
  });
});
