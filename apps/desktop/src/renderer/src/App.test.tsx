import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ResultEnvelope } from '@swaft/shared';
import { App } from './App';
import { AppProviders } from './AppProviders';
import { ApiClient } from './api-client/client';
import type { Transport } from './api-client/transport/types';
import { dispatch } from '../../main/transport/dispatch';

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

/** Render straight to the homepage — there is no auth gate, and no workspace open yet. */
async function renderHomepage() {
  const utils = renderApp();
  await screen.findByText('Recent workspaces');
  return utils;
}

describe('App (homepage)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('shows the brand, product tagline and an empty recent list on launch', async () => {
    await renderHomepage();
    // The brand now appears both in the top bar and in the centered hero.
    expect(screen.getAllByText('Swaft').length).toBeGreaterThan(0);
    expect(screen.getByText('Strange Workspace App for Technician')).toBeInTheDocument();
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
