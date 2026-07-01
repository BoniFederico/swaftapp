import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Dialog, TextField } from '../ui';
import { useWorkspace } from './WorkspaceProvider';
import { workspaceErrorKey } from './workspace-errors';

/** Password prompt shown when opening an encrypted workspace. */
export function OpenPasswordDialog({
  open,
  path,
  onClose,
}: {
  open: boolean;
  path: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { open: openWorkspace, busy, errorCode, clearError } = useWorkspace();
  const [password, setPassword] = useState('');

  function close() {
    setPassword('');
    clearError();
    onClose();
  }

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!path) return;
    try {
      await openWorkspace(path, password);
      close();
    } catch {
      /* errorCode surfaced by the provider */
    }
  }

  const errorKey = workspaceErrorKey(errorCode);

  return (
    <Dialog
      open={open}
      title={t('open.title')}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('wizard.cancel')}
          </Button>
          <Button variant="primary" disabled={busy || !password} onClick={submit}>
            {busy ? t('open.opening') : t('open.submit')}
          </Button>
        </>
      }
    >
      <form className="col" style={{ gap: 'var(--space-3)' }} onSubmit={submit}>
        <p className="subtitle" style={{ margin: 0 }}>
          {t('open.subtitle')}
        </p>
        <TextField
          label={t('wizard.password')}
          type="password"
          value={password}
          autoFocus
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />
        {errorKey && (
          <div className="auth-error" role="alert">
            {t(errorKey)}
          </div>
        )}
      </form>
    </Dialog>
  );
}
