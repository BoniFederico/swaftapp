import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import type { ResultEnvelope } from '@swaft/shared';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { dispatch } from '../../../main/transport/dispatch';
import { setSessionGate } from '../../../main/transport/session';
import { setAuthService } from '../../../main/auth/registry';
import { makeTestAuthService } from '../../../main/auth/testing';
import { getSettingsService } from '../../../main/services';
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

/** Set the URL — a CodeMirror-backed Seebo field, so `fireEvent.change` does not apply. */
function setUrl(text: string) {
  const content = document.querySelector('[aria-label="URL"]');
  const view = EditorView.findFromDOM(content?.closest('.cm-editor') as HTMLElement);
  act(() => view!.dispatch({ changes: { from: 0, to: view!.state.doc.length, insert: text } }));
}

async function signUpToWorkspaceApiTemplate() {
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'tech' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'correct-horse' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByText('Recent workspaces');

  fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
  fireEvent.change(await screen.findByLabelText('Workspace name'), { target: { value: 'WS' } });
  fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
  await waitFor(() =>
    expect(screen.getByTestId('wizard-location').textContent).toBe('mem://demo.swaft'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  await screen.findByText('Working Tree');

  // project → folder → select folder
  fireEvent.click(screen.getByRole('button', { name: 'Select project' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Create project' }));
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'P' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  await screen.findByRole('button', { name: 'Create folder' }); // wait for auto-select
  fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'F' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  fireEvent.click(await screen.findByText('F'));

  // create an API template
  fireEvent.click(screen.getByRole('button', { name: 'Create template' }));
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Call' } });
  fireEvent.click(screen.getByLabelText('Type'));
  fireEvent.click(screen.getByRole('option', { name: 'API' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  await screen.findByLabelText('URL');
}

describe('API View (M8)', () => {
  beforeEach(() => {
    localStorage.clear();
    const { service } = makeTestAuthService();
    setAuthService(service);
    setSessionGate({ isSignedIn: () => service.isSignedIn() });
  });
  afterEach(() => {
    setSessionGate({ isSignedIn: () => false });
    setAuthService(null);
    resetTestWorkspaceBackend();
  });

  it('blocks a request to a non-allow-listed domain', async () => {
    installTestWorkspaceBackend({ createPath: 'mem://demo.swaft' });
    renderApp();
    await signUpToWorkspaceApiTemplate();

    setUrl('https://example.com/x');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText(/Domain not allowed/i)).toBeInTheDocument());
  });

  it('sends to an allow-listed domain and shows the response', async () => {
    installTestWorkspaceBackend({
      createPath: 'mem://demo.swaft',
      fetchFn: (() =>
        Promise.resolve(new Response('{"pong":true}', { status: 200, statusText: 'OK' }))) as typeof fetch,
    });
    renderApp();
    await signUpToWorkspaceApiTemplate();

    // Allow the domain (the Settings UI is covered elsewhere).
    await getSettingsService().updateSettings({ allowedDomains: ['example.com'] });

    setUrl('https://example.com/x');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(screen.getByTestId('api-response-body').textContent).toContain('pong'),
    );

    // The response Headers tab (the second "Headers" tab) lists the response headers.
    fireEvent.click(screen.getAllByRole('tab', { name: 'Headers' })[1]!);
    expect(screen.getByText('content-type')).toBeInTheDocument();
  });
});
