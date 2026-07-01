import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ResultEnvelope } from '@swaft/shared';
import { App } from './App';
import { AppProviders } from './AppProviders';
import { ApiClient } from './api-client/client';
import type { Transport } from './api-client/transport/types';
import { dispatch } from '../../main/transport/dispatch';
import { setSessionGate } from '../../main/transport/session';
import { setAuthService } from '../../main/auth/registry';
import { makeTestAuthService } from '../../main/auth/testing';

/** Test transport delegates to the REAL main-process dispatch (allow-list + DTO + session guard). */
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

/** Sign up on first run and land on the homepage (no workspace open yet). */
async function renderHomepage() {
  const utils = renderApp();
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'tech' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'correct-horse' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByText('Recent workspaces');
  return utils;
}

describe('App (M4 — signed-in homepage)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    const { service } = makeTestAuthService();
    setAuthService(service);
    setSessionGate({ isSignedIn: () => service.isSignedIn() });
  });

  afterEach(() => {
    setSessionGate({ isSignedIn: () => false });
    setAuthService(null);
  });

  it('shows the brand, product tagline and an empty recent list after signing in', async () => {
    await renderHomepage();
    expect(screen.getByText('Swaft')).toBeInTheDocument();
    expect(screen.getByText('Strange Web App for Technician')).toBeInTheDocument();
    expect(screen.getByText('No workspaces yet. Create one to get started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeInTheDocument();
  });

  it('switches UI language it/en from the Preferences dialog', async () => {
    await renderHomepage();
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    fireEvent.click(await screen.findByLabelText('Language'));
    fireEvent.click(screen.getByRole('option', { name: 'Italiano' }));
    expect(screen.getByText('Workspace recenti')).toBeInTheDocument();
  });

  it('changes theme from the Preferences dialog', async () => {
    await renderHomepage();
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    fireEvent.click(await screen.findByLabelText('Theme'));
    fireEvent.click(screen.getByRole('option', { name: 'Dark' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('applies a primary color from the Preferences dialog', async () => {
    await renderHomepage();
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    fireEvent.click(await screen.findByRole('button', { name: 'primary Teal' }));
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#0D9488');
  });
});
