import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ResultEnvelope } from '@swaft/shared';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { dispatch } from '../../../main/transport/dispatch';
import { setSessionGate } from '../../../main/transport/session';
import { setAuthService } from '../../../main/auth/registry';
import { makeTestAuthService } from '../../../main/auth/testing';

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

async function signUp() {
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'tech' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'correct-horse' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByText('Recent workspaces');
}

describe('Auth flow', () => {
  beforeEach(() => {
    localStorage.clear();
    const { service } = makeTestAuthService();
    setAuthService(service);
    setSessionGate({ isSignedIn: () => service.isSignedIn() });
  });

  afterEach(() => {
    setSessionGate({ isSignedIn: () => false });
    setAuthService(null);
  });

  it('opens on the sign-up screen on first run and reaches home after sign-up', async () => {
    renderApp();
    expect(await screen.findByRole('button', { name: 'Create account' })).toBeInTheDocument();
    await signUp();
    expect(screen.getByText('Recent workspaces')).toBeInTheDocument();
  });

  it('sign-out returns to sign-in; wrong password fails generically; correct password signs in', async () => {
    renderApp();
    await signUp();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'tech' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid username or password.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Recent workspaces')).toBeInTheDocument();
  });

  it('lock shows the locked screen; unlock with the password returns home', async () => {
    renderApp();
    await signUp();

    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    expect(await screen.findByText('Locked')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Invalid username or password.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Recent workspaces')).toBeInTheDocument();
  });

  it('lets you create a second local account from the sign-in screen', async () => {
    renderApp();
    await signUp(); // first account "tech" → homepage

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create a new account' }));
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'tech2' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'another-pass' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'another-pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Recent workspaces')).toBeInTheDocument();
  });

  it('rejects client-side password mismatch on sign-up before any IPC call', async () => {
    renderApp();
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'tech' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'different1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();
    // Still on the sign-up screen (no account created).
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });
});
