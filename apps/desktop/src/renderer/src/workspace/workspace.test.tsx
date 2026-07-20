import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ResultEnvelope } from '@swaft/shared';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { dispatch } from '../../../main/transport/dispatch';
import { setSessionGate } from '../../../main/transport/session';
import { setAuthService } from '../../../main/auth/registry';
import { makeTestAuthService } from '../../../main/auth/testing';
import {
  installTestWorkspaceBackend,
  resetTestWorkspaceBackend,
} from '../../../main/workspace/testing';

class DispatchTransport implements Transport {
  call(op: string, payload?: unknown): Promise<ResultEnvelope<unknown>> {
    return dispatch(op, payload);
  }
}

function renderApp() {
  return render(
    <AppProviders>
      <App client={new ApiClient(new DispatchTransport())} />
    </AppProviders>,
  );
}

async function signUpToHomepage() {
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'tech' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'correct-horse' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByText('Recent workspaces');
}

async function createWorkspace(name = 'Field Service') {
  fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
  fireEvent.change(await screen.findByLabelText('Workspace name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
  await waitFor(() =>
    expect(screen.getByTestId('wizard-location').textContent).toBe('mem://demo.swaft'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  await screen.findByLabelText('Working Tree');
}

describe('Workspace shell (M5)', () => {
  beforeEach(() => {
    localStorage.clear();
    const { service } = makeTestAuthService();
    setAuthService(service);
    setSessionGate({ isSignedIn: () => service.isSignedIn() });
    installTestWorkspaceBackend({ createPath: 'mem://demo.swaft' });
  });

  afterEach(() => {
    setSessionGate({ isSignedIn: () => false });
    setAuthService(null);
    resetTestWorkspaceBackend();
  });

  it('opens the shell with the Working Tree and a welcome panel', async () => {
    renderApp();
    await signUpToHomepage();
    await createWorkspace();

    expect(screen.getByText('Field Service')).toBeInTheDocument();
    expect(screen.getByLabelText('Working Tree')).toBeInTheDocument();
    expect(screen.getByText('Workspace ready')).toBeInTheDocument();
  });

  it('returns to the homepage when the app logo is clicked', async () => {
    renderApp();
    await signUpToHomepage();
    await createWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(await screen.findByText('Recent workspaces')).toBeInTheDocument();
  });

  it('creates a project, then manages its folders (with delete confirmation)', async () => {
    renderApp();
    await signUpToHomepage();
    await createWorkspace();

    // Create a project via the picker (its last item) → it becomes the selected project.
    fireEvent.click(screen.getByRole('button', { name: 'Select project' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create project' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Alpha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    // Once the project is selected, its actions (Create folder/template) appear.
    await screen.findByRole('button', { name: 'Create folder' });

    // Create a folder (the action is enabled once a project is selected).
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Inbox' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Inbox')).toBeInTheDocument();

    // Rename it via the context menu.
    fireEvent.click(screen.getByRole('button', { name: 'Inbox actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Outbox' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Outbox')).toBeInTheDocument();

    // Delete it → a confirmation dialog is required.
    fireEvent.click(screen.getByRole('button', { name: 'Outbox actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByText(/Delete folder/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Outbox')).toBeNull());
  });

  it('gates the developer execution mode behind confirmation in Settings', async () => {
    renderApp();
    await signUpToHomepage();
    await createWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    // The settings modal opens on General; go to the Restrictions section.
    fireEvent.click(await screen.findByRole('button', { name: 'Restrictions' }));
    // Switch execution mode to Developer → the warning appears (blocked by the backend).
    fireEvent.click(await screen.findByLabelText('Execution mode'));
    fireEvent.click(screen.getByRole('option', { name: 'Developer' }));
    expect(await screen.findByText(/relaxes safety checks/i)).toBeInTheDocument();

    // Confirm unlocks Save; the warning clears only once the change is actually saved.
    fireEvent.click(screen.getByRole('button', { name: 'I understand — enable developer mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByText(/relaxes safety checks/i)).toBeNull());
  });

  it('creates and opens a document template, fills inputs and renders via Seebo', async () => {
    renderApp();
    await signUpToHomepage();
    await createWorkspace();

    // Project
    fireEvent.click(screen.getByRole('button', { name: 'Select project' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create project' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Alpha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByRole('button', { name: 'Create folder' });

    // Folder, then select it
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Docs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    fireEvent.click(await screen.findByText('Docs'));

    // Template (auto-opens the Document View)
    fireEvent.click(screen.getByRole('button', { name: 'Create template' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Greeting' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    // The Input Panel shows the widget from the starter source (a textbox labelled "Your name").
    const nameInput = await screen.findByLabelText('Your name');
    fireEvent.change(nameInput, { target: { value: 'Ada' } });

    // Seebo renders the output automatically (no Render button).
    await waitFor(() => expect(screen.getByText('Hello Ada!')).toBeInTheDocument());

    // Redesign: open the Template Editor modal and cut a named release; the changelog records it.
    fireEvent.click(screen.getByRole('button', { name: 'Greeting actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    await screen.findByLabelText('Source');
    fireEvent.click(screen.getByRole('button', { name: 'New release' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Final' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    // Open the changelog panel and verify the entry is attributed to the signed-in user.
    fireEvent.click(screen.getByRole('button', { name: 'Changelog' }));
    expect(await screen.findByText('Release "Final" created')).toBeInTheDocument();
    expect(await screen.findByText(/tech ·/)).toBeInTheDocument();
  });

  it('renames the workspace from the Settings modal (General section)', async () => {
    renderApp();
    await signUpToHomepage();
    await createWorkspace('Field Service');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const nameField = await screen.findByLabelText('Workspace name');
    fireEvent.change(nameField, { target: { value: 'Renamed WS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The top bar reflects the new name (the modal sits over the workspace).
    await waitFor(() => expect(screen.getByText('Renamed WS')).toBeInTheDocument());
  });

  it('shows the unrecoverability warning and blocks mismatched encryption passwords', async () => {
    renderApp();
    await signUpToHomepage();

    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    fireEvent.change(await screen.findByLabelText('Workspace name'), { target: { value: 'Enc WS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    await waitFor(() =>
      expect(screen.getByTestId('wizard-location').textContent).toBe('mem://demo.swaft'),
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Encrypt this workspace' }));
    expect(screen.getByText(/cannot be recovered/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Workspace password'), { target: { value: 'longenough' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'different1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Working Tree')).toBeNull();
  });
});
