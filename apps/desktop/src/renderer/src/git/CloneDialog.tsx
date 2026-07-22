import { useState } from 'react';
import { ApiError } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Dialog, TextField } from '../ui';
import { useWorkspace } from '../workspace/WorkspaceProvider';

/**
 * Clone a Git workspace repository from a URL (GitHub / CodeCommit / GitLab / …) into a chosen parent
 * folder, then open it. Authentication uses the user's system git credentials
 * (SSH keys / credential helper), inherited by the shelled-out `git`.
 */
export function CloneDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { cloneAndOpen, pickDirectory, busy } = useWorkspace();
  const [url, setUrl] = useState('');
  const [parentDir, setParentDir] = useState('');
  const [error, setError] = useState<string | null>(null);

  function close() {
    setUrl('');
    setParentDir('');
    setError(null);
    onClose();
  }

  async function chooseFolder() {
    const dir = await pickDirectory();
    if (dir) setParentDir(dir);
  }

  async function onSubmit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setError(null);
    try {
      await cloneAndOpen(url.trim(), parentDir);
      close();
    } catch (err) {
      // Surface git's own message (e.g. "repository not found", auth failure).
      setError(err instanceof ApiError ? err.swaft.message : t('git.cloneError'));
    }
  }

  const canSubmit = url.trim().length > 0 && parentDir.length > 0 && !busy;

  return (
    <Dialog
      open={open}
      title={t('clone.title')}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('wizard.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={onSubmit}>
            {busy ? t('clone.cloning') : t('clone.submit')}
          </Button>
        </>
      }
    >
      <form className="col" style={{ gap: 'var(--space-4)' }} onSubmit={onSubmit}>
        <TextField
          label={t('clone.url')}
          placeholder="https://github.com/acme/workspace.git"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <div className="ui-field">
          <span className="ui-field__label">{t('clone.parentDir')}</span>
          <div className="row">
            <Button type="button" variant="secondary" onClick={chooseFolder}>
              {t('wizard.chooseFolder')}
            </Button>
            <span className="muted" data-testid="clone-parent">
              {parentDir || t('wizard.noLocation')}
            </span>
          </div>
        </div>
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
      </form>
    </Dialog>
  );
}
