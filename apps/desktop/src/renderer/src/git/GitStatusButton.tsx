import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GitStatusDto } from '@swaft/shared';
import { ApiError, type ApiClient } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import { Button, GitBranchIcon, TextField, useToast } from '../ui';
import { usePopover } from '../ui/usePopover';
import { notifyTreeChanged } from '../workspace/treeBus';
import { useWorkspace } from '../workspace/WorkspaceProvider';

/**
 * The top-right Git widget for a `git` workspace (git.md §6.2): a compact trigger showing the current
 * branch + a dirty indicator, opening a popover with the common operations — view changes, commit,
 * pull/push/fetch, switch/create branch, discard. Ops that rewrite the files on disk (pull, checkout,
 * discard) trigger a workspace refresh + tree reload so the rest of the app reflects the new content.
 */
export function GitStatusButton({ client }: { client: ApiClient }) {
  const { t } = useI18n();
  const { refresh } = useWorkspace();
  const toast = useToast();
  const { open, pos, triggerRef, popRef, toggle } = usePopover<HTMLDivElement>(320);

  const [status, setStatus] = useState<GitStatusDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [publishUrl, setPublishUrl] = useState('');
  const [showPublish, setShowPublish] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus((await client.call('git.status')).status);
    } catch {
      /* keep the last known status; the next op surfaces the error */
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  // Re-check status when the window regains focus, so external edits/CLI pulls are reflected.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  /** Run a git op, update status, and (when it changed files on disk) refresh the workspace + tree. */
  async function op(run: () => Promise<{ status: GitStatusDto }>, reload = false): Promise<boolean> {
    setBusy(true);
    try {
      setStatus((await run()).status);
      if (reload) {
        await refresh();
        notifyTreeChanged();
      }
      return true;
    } catch (err) {
      toast.show(err instanceof ApiError ? err.swaft.message : t('git.error'), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    const msg = message.trim();
    if (!msg) return;
    if (await op(() => client.call('git.commit', { message: msg }))) setMessage('');
  }

  async function createBranch() {
    const name = newBranch.trim();
    if (!name) return;
    if (await op(() => client.call('git.createBranch', { name }))) {
      setNewBranch('');
      setCreatingBranch(false);
    }
  }

  async function publish() {
    const url = publishUrl.trim();
    if (!url) return;
    if (await op(() => client.call('git.publish', { url }))) {
      setPublishUrl('');
      setShowPublish(false);
    }
  }

  const branch = status?.branch ?? '—';
  const dirty = status ? !status.clean : false;
  const aheadBehind = status && (status.ahead || status.behind);
  const hasRemote = status?.remoteUrl != null;
  const hasConflicts = status?.files.some((f) => f.status === 'conflicted') ?? false;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`git-trigger${dirty ? ' is-dirty' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('git.label')}
        onClick={toggle}
      >
        <GitBranchIcon className="git-trigger__icon" />
        <span className="git-trigger__branch">{branch}</span>
        {dirty && <span className="git-trigger__dot" title={t('git.dirty')} aria-hidden="true" />}
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="git-panel"
            role="dialog"
            aria-label={t('git.label')}
            style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: 320 }}
          >
            <div className="git-panel__head">
              <GitBranchIcon />
              <span className="git-panel__branch">{branch}</span>
              <span className={`ui-badge git-panel__state${dirty ? ' is-dirty' : ''}`}>
                {dirty ? t('git.dirtyLabel') : t('git.clean')}
              </span>
              {aheadBehind ? (
                <span className="git-panel__track muted">
                  ↑{status?.ahead ?? 0} ↓{status?.behind ?? 0}
                </span>
              ) : null}
            </div>
            {hasRemote && (
              <div className="git-panel__remote muted" title={status?.remoteUrl ?? undefined}>
                {status?.remoteUrl}
              </div>
            )}

            {hasConflicts && (
              <div className="git-panel__conflict" role="alert">
                {t('git.conflict')}
              </div>
            )}

            {status && status.branches.length > 0 && (
              <div className="git-panel__row">
                <label className="git-panel__label" htmlFor="git-branch-select">
                  {t('git.branch')}
                </label>
                <select
                  id="git-branch-select"
                  className="git-panel__select"
                  value={status.branch ?? ''}
                  disabled={busy}
                  onChange={(e) => void op(() => client.call('git.checkout', { branch: e.target.value }), true)}
                >
                  {status.branch == null && <option value="">{t('git.detached')}</option>}
                  {status.branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="git-panel__link"
                  disabled={busy}
                  onClick={() => setCreatingBranch((v) => !v)}
                >
                  {t('git.newBranch')}
                </button>
              </div>
            )}

            {creatingBranch && (
              <div className="git-panel__row">
                <TextField
                  label={t('git.newBranchName')}
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                />
                <Button variant="secondary" disabled={busy || !newBranch.trim()} onClick={() => void createBranch()}>
                  {t('git.create')}
                </Button>
              </div>
            )}

            <div className="git-panel__changes">
              <div className="git-panel__label">{t('git.changes')}</div>
              {status && status.files.length > 0 ? (
                <ul className="git-panel__files">
                  {status.files.map((f) => (
                    <li key={f.path} className={`git-file git-file--${f.status}`}>
                      <span className="git-file__mark" aria-hidden="true">
                        {f.status[0]!.toUpperCase()}
                      </span>
                      <span className="git-file__text">
                        <span className="git-file__name">{f.label ?? f.path}</span>
                        {f.label && <span className="git-file__path muted">{f.path}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="git-panel__empty muted">{t('git.noChanges')}</div>
              )}
            </div>

            <div className="git-panel__commit">
              <TextField
                label={t('git.commitMessage')}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <Button
                variant="primary"
                disabled={busy || !dirty || hasConflicts || !message.trim()}
                onClick={() => void commit()}
              >
                {t('git.commit')}
              </Button>
            </div>

            {showPublish && !hasRemote && (
              <div className="git-panel__row">
                <TextField
                  label={t('git.remoteUrl')}
                  value={publishUrl}
                  onChange={(e) => setPublishUrl(e.target.value)}
                />
                <Button variant="secondary" disabled={busy || !publishUrl.trim()} onClick={() => void publish()}>
                  {t('git.publishAction')}
                </Button>
              </div>
            )}

            <div className="git-panel__actions">
              {hasRemote ? (
                <>
                  <Button variant="ghost" disabled={busy} onClick={() => void op(() => client.call('git.fetch'))}>
                    {t('git.fetch')}
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void op(() => client.call('git.pull'), true)}>
                    {t('git.pull')}
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void op(() => client.call('git.push'))}>
                    {t('git.push')}
                  </Button>
                </>
              ) : (
                <Button variant="ghost" disabled={busy} onClick={() => setShowPublish((v) => !v)}>
                  {t('git.publish')}
                </Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={() => void op(() => client.call('git.reload'), true)}>
                {t('git.reload')}
              </Button>
              <Button
                variant="ghost"
                disabled={busy || !dirty}
                onClick={() => {
                  if (window.confirm(t('git.discardConfirm'))) void op(() => client.call('git.discard'), true);
                }}
              >
                {t('git.discard')}
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
