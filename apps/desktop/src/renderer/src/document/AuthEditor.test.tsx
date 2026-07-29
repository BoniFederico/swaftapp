import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { HttpAuth } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { AuthEditor } from './AuthEditor';

function renderAuth(auth: HttpAuth, onChange = vi.fn()) {
  render(
    <AppProviders>
      <AuthEditor auth={auth} onChange={onChange} inherited={null} />
    </AppProviders>,
  );
  return onChange;
}

describe('AuthEditor — legacy secretRef migration (open-standards §3.4 item 3)', () => {
  it('shows nothing when there is no legacy secretRef', () => {
    renderAuth({ kind: 'bearer', token: 'abc' });
    expect(screen.queryByRole('button', { name: /Migrate to secret/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove unused reference/ })).toBeNull();
  });

  it('offers to migrate when the target field is empty, and does so on click', () => {
    const onChange = renderAuth({ kind: 'bearer', secretRef: 'legacy-token' });
    expect(screen.getByText(/legacy-token/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Migrate to secret(...)' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'bearer', token: "${ secret('legacy-token') }" });
  });

  it('offers only removal when the target field already has a value', () => {
    const onChange = renderAuth({ kind: 'bearer', token: 'already-set', secretRef: 'legacy-token' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove unused reference' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'bearer', token: 'already-set' });
  });

  it('migrates into the password field for basic auth', () => {
    const onChange = renderAuth({ kind: 'basic', username: 'me', secretRef: 'legacy-pw' });
    fireEvent.click(screen.getByRole('button', { name: 'Migrate to secret(...)' }));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'basic',
      username: 'me',
      password: "${ secret('legacy-pw') }",
    });
  });

  it('migrates into the value field for apikey auth', () => {
    const onChange = renderAuth({ kind: 'apikey', key: 'X-Api-Key', secretRef: 'legacy-key' });
    fireEvent.click(screen.getByRole('button', { name: 'Migrate to secret(...)' }));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'apikey',
      key: 'X-Api-Key',
      value: "${ secret('legacy-key') }",
    });
  });

  it('offers only removal when the kind has no target field at all', () => {
    const onChange = renderAuth({ kind: 'none', secretRef: 'orphaned' });
    expect(screen.queryByRole('button', { name: /Migrate/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove unused reference' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'none' });
  });
});
