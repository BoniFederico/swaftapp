import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ok, type ResultEnvelope, type WorkspaceSettingsDto, type WorkspaceSettingsUpdate } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { RestrictionsSettings } from './sections/RestrictionsSettings';

const INITIAL: WorkspaceSettingsDto = {
  executionMode: 'sandbox',
  batcherEnabled: true,
  blockedDomains: [],
  proxyUrl: null,
  enforcedHeaders: {},
};

/** Fake transport recording every settings.update it receives. */
function makeTransport(updates: WorkspaceSettingsUpdate[]): Transport {
  let settings = { ...INITIAL };
  return {
    call(op, payload): Promise<ResultEnvelope<unknown>> {
      if (op === 'settings.get') return Promise.resolve(ok({ settings }));
      if (op === 'settings.update') {
        const patch = payload as WorkspaceSettingsUpdate;
        updates.push(patch);
        settings = { ...settings, ...patch };
        return Promise.resolve(ok({ settings }));
      }
      return Promise.resolve(ok({}));
    },
  };
}

function renderSection() {
  const updates: WorkspaceSettingsUpdate[] = [];
  render(
    <AppProviders>
      <RestrictionsSettings client={new ApiClient(makeTransport(updates))} />
    </AppProviders>,
  );
  return updates;
}

describe('RestrictionsSettings — nothing is stored until Save', () => {
  it('enables Save on a batcher toggle and only then writes the change', async () => {
    const updates = renderSection();
    const save = await screen.findByRole('button', { name: /save/i });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(save).toBeEnabled());
    // The toggle alone must not have reached the backend.
    expect(updates).toEqual([]);

    fireEvent.click(save);
    await waitFor(() => expect(updates).toEqual([{ batcherEnabled: false }]));
  });

  it('reverts every pending edit on Cancel without writing anything', async () => {
    const updates = renderSection();
    const save = await screen.findByRole('button', { name: /save/i });
    const proxy = screen.getByLabelText(/proxy/i);

    fireEvent.change(proxy, { target: { value: 'http://proxy:8080' } });
    await waitFor(() => expect(save).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(save).toBeDisabled());
    expect((proxy as HTMLInputElement).value).toBe('');
    expect(updates).toEqual([]);
  });

  it('keeps Save disabled when switching to dev mode until the warning is confirmed', async () => {
    const updates = renderSection();
    const save = await screen.findByRole('button', { name: /save/i });

    // The execution-mode listbox: open it and pick the Developer option.
    fireEvent.click(screen.getByRole('button', { name: /execution mode/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'Developer' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /I understand/i }));
    await waitFor(() => expect(save).toBeEnabled());

    fireEvent.click(save);
    await waitFor(() =>
      expect(updates).toEqual([{ executionMode: 'dev', confirmDev: true }]),
    );
  });
});

// Guard against the auto-persist regression: the hook must not write preferences on its own.
describe('usePreferencesSync', () => {
  it('never calls prefs.set', async () => {
    const calls: string[] = [];
    const transport: Transport = {
      call(op): Promise<ResultEnvelope<unknown>> {
        calls.push(op);
        if (op === 'prefs.get') return Promise.resolve(ok({ preferences: { themeMode: 'dark' } }));
        return Promise.resolve(ok({}));
      },
    };
    const { usePreferencesSync } = await import('./usePreferencesSync');
    function Probe() {
      usePreferencesSync(new ApiClient(transport));
      return null;
    }
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );
    await waitFor(() => expect(calls).toContain('prefs.get'));
    expect(calls).not.toContain('prefs.set');
    vi.restoreAllMocks();
  });
});
