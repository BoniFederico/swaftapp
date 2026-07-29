import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { makeError, ok, type GitStatusDto, type ResultEnvelope } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { WorkspaceProvider } from '../workspace/WorkspaceProvider';
import { GitStatusButton } from './GitStatusButton';

const DIRTY: GitStatusDto = {
  branch: 'main',
  detached: false,
  hasUpstream: true,
  ahead: 1,
  behind: 0,
  clean: false,
  files: [{ path: 'templates/tpl-1/template.json', status: 'modified', staged: false }],
  branches: ['main', 'dev'],
  remoteUrl: 'https://example.test/acme/ws.git',
};

const CLEAN: GitStatusDto = { ...DIRTY, clean: true, files: [], ahead: 0 };

interface PanelOpts {
  remoteUrl?: string | null;
  files?: GitStatusDto['files'];
}

/** Fake transport recording git op calls; commit flips the status to clean. */
function makeTransport(calls: { op: string; payload: unknown }[], opts: PanelOpts = {}): Transport {
  const remoteUrl = opts.remoteUrl === undefined ? DIRTY.remoteUrl : opts.remoteUrl;
  const files = opts.files ?? DIRTY.files;
  let status = { ...DIRTY, remoteUrl, files, clean: files.length === 0 };
  return {
    call(op, payload): Promise<ResultEnvelope<unknown>> {
      calls.push({ op, payload });
      switch (op) {
        case 'git.status':
        case 'git.reload':
          return Promise.resolve(ok({ status }));
        case 'git.available':
          return Promise.resolve(ok({ available: true, version: 'git version test' }));
        case 'git.fileDiff':
          return Promise.resolve(
            ok({ path: (payload as { path: string }).path, old: '{"name":"old"}', current: '{"name":"new"}' }),
          );
        case 'git.commit':
          status = { ...CLEAN, remoteUrl };
          return Promise.resolve(ok({ status }));
        case 'git.publish':
          status = { ...status, remoteUrl: (payload as { url: string }).url };
          return Promise.resolve(ok({ status }));
        case 'git.checkout':
        case 'git.pull':
        case 'git.push':
        case 'git.fetch':
        case 'git.discard':
        case 'git.createBranch':
          return Promise.resolve(ok({ status }));
        case 'workspace.current':
          return Promise.resolve(ok({ workspace: null }));
        case 'workspace.recent':
          return Promise.resolve(ok({ items: [] }));
        default:
          return Promise.resolve(ok({}));
      }
    },
  };
}

function renderPanel(opts: PanelOpts = {}) {
  const calls: { op: string; payload: unknown }[] = [];
  const client = new ApiClient(makeTransport(calls, opts));
  render(
    <AppProviders>
      <WorkspaceProvider client={client}>
        <GitStatusButton client={client} />
      </WorkspaceProvider>
    </AppProviders>,
  );
  return { calls };
}

describe('GitStatusButton', () => {
  it('shows the current branch and a dirty indicator', async () => {
    renderPanel();
    const trigger = await screen.findByRole('button', { name: 'Git' });
    await waitFor(() => expect(trigger).toHaveTextContent('main'));
    expect(trigger.querySelector('.git-trigger__dot')).not.toBeNull();
  });

  it('opens the panel, lists changes, and commits with a message', async () => {
    const { calls } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Git' }));

    // Changes are listed.
    expect(await screen.findByText('templates/tpl-1/template.json')).toBeInTheDocument();

    // Commit is gated on a message; type one and commit.
    const message = screen.getByLabelText('Commit message');
    fireEvent.change(message, { target: { value: 'update template' } });
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));

    await waitFor(() =>
      expect(calls.some((c) => c.op === 'git.commit')).toBe(true),
    );
    expect(calls.find((c) => c.op === 'git.commit')?.payload).toEqual({ message: 'update template' });
    // After a clean commit the working tree shows no changes.
    await waitFor(() => expect(screen.getByText('Working tree clean.')).toBeInTheDocument());
  });

  it('switches branch via the selector', async () => {
    const { calls } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Git' }));
    // Open the shared Select and choose another branch.
    fireEvent.click(await screen.findByRole('button', { name: 'Branch' }));
    fireEvent.click(await screen.findByRole('option', { name: 'dev' }));
    await waitFor(() => expect(calls.some((c) => c.op === 'git.checkout')).toBe(true));
    expect(calls.find((c) => c.op === 'git.checkout')?.payload).toEqual({ branch: 'dev' });
  });

  it('offers Publish when there is no remote, and publishes a URL', async () => {
    const { calls } = renderPanel({ remoteUrl: null });
    fireEvent.click(await screen.findByRole('button', { name: 'Git' }));
    // Without a remote there is no Push button; a Publish… action is offered instead.
    expect(screen.queryByRole('button', { name: 'Push' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Publish…' }));
    fireEvent.change(screen.getByLabelText('Remote URL'), {
      target: { value: 'https://example.test/acme/ws.git' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(calls.some((c) => c.op === 'git.publish')).toBe(true));
    expect(calls.find((c) => c.op === 'git.publish')?.payload).toEqual({
      url: 'https://example.test/acme/ws.git',
    });
  });

  it('shows the friendly entity name for a changed file', async () => {
    renderPanel({
      files: [{ path: 'templates/tpl-1/template.json', status: 'modified', staged: false, label: 'Release notes' }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Git' }));
    expect(await screen.findByText('Release notes')).toBeInTheDocument();
    // The raw path is kept as secondary detail.
    expect(screen.getByText('templates/tpl-1/template.json')).toBeInTheDocument();
  });

  it('opens a side-by-side diff when a change is clicked', async () => {
    const { calls } = renderPanel({
      files: [{ path: 'templates/tpl-1/template.json', status: 'modified', staged: false, label: 'Release notes' }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Git' }));
    fireEvent.click(await screen.findByRole('button', { name: /Release notes/i }));

    // The diff dialog opens with both panes.
    expect(await screen.findByText('Committed (HEAD)')).toBeInTheDocument();
    expect(screen.getByText('Working tree')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.op === 'git.fileDiff')).toBe(true));
    expect(calls.find((c) => c.op === 'git.fileDiff')?.payload).toEqual({
      path: 'templates/tpl-1/template.json',
    });
  });

  it('reloads the workspace on demand', async () => {
    const { calls } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Git' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(calls.some((c) => c.op === 'git.reload')).toBe(true));
  });

  it('shows a confirm dialog on a SECRETS_FOUND refusal, then commits with force on confirm', async () => {
    const calls: { op: string; payload: unknown }[] = [];
    let status = { ...DIRTY };
    const client = new ApiClient({
      call(op, payload): Promise<ResultEnvelope<unknown>> {
        calls.push({ op, payload });
        if (op === 'git.status' || op === 'git.reload') return Promise.resolve(ok({ status }));
        if (op === 'git.available') return Promise.resolve(ok({ available: true, version: 'v' }));
        if (op === 'workspace.current') return Promise.resolve(ok({ workspace: null }));
        if (op === 'workspace.recent') return Promise.resolve(ok({ items: [] }));
        if (op === 'git.commit') {
          const force = (payload as { force?: boolean }).force ?? false;
          if (!force) {
            return Promise.resolve(
              makeError('SECRETS_FOUND', 'validation', 'Probable secret literal(s) found.', {
                findings: [
                  { path: 'templates/call.t1/request.http', findings: [{ kind: 'known-token', hint: 'ghp…IJ' }] },
                ],
              }),
            );
          }
          status = { ...CLEAN, remoteUrl: status.remoteUrl };
          return Promise.resolve(ok({ status }));
        }
        return Promise.resolve(ok({}));
      },
    });
    render(
      <AppProviders>
        <WorkspaceProvider client={client}>
          <GitStatusButton client={client} />
        </WorkspaceProvider>
      </AppProviders>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Git' }));
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'add call' } });
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));

    expect(await screen.findByText('Possible secrets found')).toBeInTheDocument();
    expect(screen.getByText(/known-token/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Commit anyway' }));

    await waitFor(() =>
      expect(calls.filter((c) => c.op === 'git.commit')).toHaveLength(2),
    );
    expect(calls.filter((c) => c.op === 'git.commit')[1]?.payload).toEqual({
      message: 'add call',
      force: true,
    });
    await waitFor(() => expect(screen.getByText('Working tree clean.')).toBeInTheDocument());
  });

  it('warns on conflicts and blocks committing', async () => {
    renderPanel({
      files: [{ path: 'environments/e1.json', status: 'conflicted', staged: false, label: 'staging' }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Git' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/conflicts/i);
    // Even with a message typed, commit stays disabled while conflicts exist.
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'x' } });
    expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled();
  });
});
