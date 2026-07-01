import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ResultEnvelope } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { EnvironmentPicker } from '../environment/EnvironmentPicker';
import { EnvironmentProvider } from '../environment/EnvironmentProvider';
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

describe('Document View — renderable subtype', () => {
  beforeEach(() => setSessionGate({ isSignedIn: () => true }));
  afterEach(() => {
    setSessionGate({ isSignedIn: () => false });
    resetTestWorkspaceBackend();
  });

  it('renders a renderable subtype (no inputs → no input panel) with a version listbox', async () => {
    const { workspace } = installTestWorkspaceBackend();
    await workspace.create({ name: 'WS', location: 'mem://r.swaft', encrypt: false });
    const org = getOrganizationService();
    let tree = await org.createProject({ name: 'P' });
    tree = await org.createFolder({ name: 'F', projectId: tree.projects[0]!.id });
    const folderId = tree.folders[0]!.id;
    const res = await getTemplateService().createTemplate({
      folderId,
      name: 'Page',
      type: 'document',
      subtype: 'html',
      source: '<b>Hi</b>',
    });
    const id = res.templates.find((x) => x.name === 'Page')!.id;

    render(
      <AppProviders>
        <DocumentView client={client} templateId={id} />
      </AppProviders>,
    );

    // No inputs → no Input container; the output renders (iframe) and the version listbox shows Draft.
    // The auto-render debounces (300ms) before the engine runs, so allow generous time under load.
    expect(await screen.findByTitle('Preview', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.queryByLabelText('Input')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Render' })).not.toBeInTheDocument();
  });

  it('re-renders the open document when the active environment changes (no reopen needed)', async () => {
    const { workspace, environments } = installTestWorkspaceBackend();
    await workspace.create({ name: 'WS', location: 'mem://env.swaft', encrypt: false });
    const org = getOrganizationService();
    const tree = await org.createProject({ name: 'P' });
    const projectId = tree.projects[0]!.id;
    const tpl = await getTemplateService().createTemplate({
      projectId,
      folderId: null,
      name: 'Greet',
      type: 'document',
      subtype: 'text',
      source: "${ env({ id:'greeting', type:string() }) }",
    });
    const id = tpl.templates.find((x) => x.name === 'Greet')!.id;

    // Two environments with different values for the same key; start on "Dev".
    const dev = await environments.create({ name: 'Dev', ownerKind: 'workspace' });
    await environments.update(dev.id, { vars: { greeting: 'Hi' } });
    const prod = await environments.create({ name: 'Prod', ownerKind: 'workspace' });
    await environments.update(prod.id, { vars: { greeting: 'Ciao' } });
    await environments.setSelection(dev.id);

    render(
      <AppProviders>
        <EnvironmentProvider client={client}>
          <EnvironmentPicker onManage={() => {}} />
          <DocumentView client={client} templateId={id} />
        </EnvironmentProvider>
      </AppProviders>,
    );

    // The document resolves env('greeting') from the active "Dev" environment.
    expect(await screen.findByText('Hi', {}, { timeout: 4000 })).toBeInTheDocument();

    // Switch the active environment from the header picker — the open document re-renders in place.
    fireEvent.click(await screen.findByRole('button', { name: 'Active environment' }));
    fireEvent.click(await screen.findByText('Prod'));
    expect(await screen.findByText('Ciao', {}, { timeout: 4000 })).toBeInTheDocument();
  });
});
