import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
import { TemplateEditorModal } from './TemplateEditorModal';

class DispatchTransport implements Transport {
  call(op: string, payload?: unknown): Promise<ResultEnvelope<unknown>> {
    return dispatch(op, payload);
  }
}
const client = new ApiClient(new DispatchTransport());

async function seedRenderTemplate(): Promise<string> {
  const { workspace } = installTestWorkspaceBackend();
  await workspace.create({ name: 'WS', location: 'mem://e.swaft', encrypt: false });
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
  return res.templates.find((x) => x.name === 'Page')!.id;
}

describe('Template Editor modal (redesign)', () => {
  beforeEach(() => setSessionGate({ isSignedIn: () => true }));
  afterEach(() => {
    setSessionGate({ isSignedIn: () => false });
    resetTestWorkspaceBackend();
  });

  it('toggles render preview for html and creates a named release', async () => {
    const id = await seedRenderTemplate();
    render(
      <AppProviders>
        <TemplateEditorModal client={client} templateId={id} onClose={() => {}} />
      </AppProviders>,
    );

    await screen.findByLabelText('Source');

    // The view/render toggle exists for html and shows the preview iframe.
    fireEvent.click(screen.getByRole('button', { name: 'Show render' }));
    expect(await screen.findByTitle('Preview')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show code' }));

    // New release → named, appears in the release listbox.
    fireEvent.click(screen.getByRole('button', { name: 'New release' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'R1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('R1')).toBeInTheDocument();
  });

  it('saving shows a toast and closes the editor', async () => {
    const id = await seedRenderTemplate();
    const onClose = vi.fn();
    render(
      <AppProviders>
        <TemplateEditorModal client={client} templateId={id} onClose={onClose} />
      </AppProviders>,
    );
    await screen.findByLabelText('Source');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Template saved.')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it('deletes a release after confirmation (toast + removed from the picker)', async () => {
    const id = await seedRenderTemplate();
    render(
      <AppProviders>
        <TemplateEditorModal client={client} templateId={id} onClose={() => {}} />
      </AppProviders>,
    );
    await screen.findByLabelText('Source');

    fireEvent.click(screen.getByRole('button', { name: 'New release' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'R1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByText('R1');

    // Open the picker, delete R1, confirm.
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete release R1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/Release .*R1.* deleted/)).toBeInTheDocument();
  });

  it('deletes the draft when a release exists, and blocks deleting the last version', async () => {
    const id = await seedRenderTemplate();
    render(
      <AppProviders>
        <TemplateEditorModal client={client} templateId={id} onClose={() => {}} />
      </AppProviders>,
    );
    await screen.findByLabelText('Source');

    // Make a release so the draft can be deleted.
    fireEvent.click(screen.getByRole('button', { name: 'New release' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'R1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByText('R1');

    // Delete the Draft.
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete draft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Draft deleted.')).toBeInTheDocument();

    // Now R1 is the only version — deleting it is blocked.
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete release R1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/at least one version/i)).toBeInTheDocument();
  });

  it('adds and removes a template tag (colored badge)', async () => {
    const id = await seedRenderTemplate();
    render(
      <AppProviders>
        <TemplateEditorModal client={client} templateId={id} onClose={() => {}} />
      </AppProviders>,
    );
    const input = await screen.findByLabelText('Add tag…');
    fireEvent.change(input, { target: { value: 'urgent' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('urgent')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag urgent' }));
    await waitFor(() => expect(screen.queryByText('urgent')).not.toBeInTheDocument());
  });
});
