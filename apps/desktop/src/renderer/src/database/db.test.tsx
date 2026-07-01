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
import { openSqliteDb } from '../../../main/storage/sqlite';
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

async function makeSqliteDb(): Promise<Uint8Array> {
  const db = await openSqliteDb();
  db.exec(`CREATE TABLE users (id INTEGER, name TEXT); INSERT INTO users VALUES (1, 'Ada'), (2, 'Lin');`);
  const bytes = db.export();
  db.close();
  return bytes;
}

async function signUpAndOpenWorkspace() {
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
}

describe('Database View (M9)', () => {
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

  it('runs a read-only SELECT and blocks a DELETE', async () => {
    const { files } = installTestWorkspaceBackend({
      createPath: 'mem://demo.swaft',
      dbFile: 'mem://test.db',
    });
    files.set('mem://test.db', await makeSqliteDb());

    renderApp();
    await signUpAndOpenWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Database' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Choose file…' }));
    await waitFor(() => expect(screen.getByText('mem://test.db')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('SQL'), {
      target: { value: 'SELECT name FROM users ORDER BY id' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument());

    // DELETE is blocked, read-only by default.
    fireEvent.change(screen.getByLabelText('SQL'), { target: { value: 'DELETE FROM users' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByText(/read-only/i)).toBeInTheDocument());
  });
});
