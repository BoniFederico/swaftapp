import { useState } from 'react';
import type { ExecutionMode } from '@swaft/shared';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/catalogs';
import { Button, Dialog, Select, Switch, TextField } from '../ui';
import { useWorkspace } from './WorkspaceProvider';
import { workspaceErrorKey } from './workspace-errors';

/**
 * Create Workspace wizard (SWAFT_UI_SPEC.md §3). Storage mode is shown **immutable** (local only),
 * encryption is opt-in with an **unrecoverability** acknowledgement, and execution mode defaults to
 * `sandbox`. The `.swaft` location is chosen via a native save dialog (platform shim in main).
 */
export function CreateWorkspaceWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { create, busy, errorCode, clearError, pickCreateTarget } = useWorkspace();

  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('sandbox');
  const [localError, setLocalError] = useState<TranslationKey | null>(null);

  function reset() {
    setName('');
    setLocation('');
    setEncrypt(false);
    setPassword('');
    setConfirm('');
    setExecutionMode('sandbox');
    setLocalError(null);
    clearError();
  }

  function close() {
    reset();
    onClose();
  }

  async function chooseLocation() {
    const path = await pickCreateTarget(name);
    if (path) setLocation(path);
  }

  async function onSubmit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setLocalError(null);
    clearError();
    if (encrypt) {
      if (password.length < 8) return setLocalError('auth.error.tooShort');
      if (password !== confirm) return setLocalError('auth.error.mismatch');
    }
    try {
      await create({
        name: name.trim(),
        location,
        encrypt,
        password: encrypt ? password : undefined,
        executionMode,
      });
      close();
    } catch {
      /* errorCode surfaced by the provider */
    }
  }

  const errorKey = localError ?? workspaceErrorKey(errorCode);
  const canSubmit = name.trim().length > 0 && location.length > 0 && !busy;

  return (
    <Dialog
      open={open}
      title={t('wizard.title')}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('wizard.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={onSubmit}>
            {busy ? t('wizard.creating') : t('wizard.submit')}
          </Button>
        </>
      }
    >
      <form className="col" style={{ gap: 'var(--space-4)' }} onSubmit={onSubmit}>
        <TextField
          label={t('wizard.name')}
          placeholder={t('wizard.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="ui-field">
          <span className="ui-field__label">{t('wizard.location')}</span>
          <div className="row">
            <Button type="button" variant="secondary" onClick={chooseLocation}>
              {t('wizard.chooseLocation')}
            </Button>
            <span className="muted" data-testid="wizard-location">
              {location || t('wizard.noLocation')}
            </span>
          </div>
        </div>

        <div className="ui-field">
          <span className="ui-field__label">{t('wizard.storageMode')}</span>
          <div className="row">
            <span className="ui-badge">{t('wizard.storageModeLocal')}</span>
          </div>
          <div className="field-hint">{t('wizard.storageImmutable')}</div>
        </div>

        <Select
          label={t('wizard.executionMode')}
          value={executionMode}
          onChange={(v) => setExecutionMode(v as ExecutionMode)}
          options={[
            { value: 'sandbox', label: t('wizard.exec.sandbox') },
            { value: 'dev', label: t('wizard.exec.dev') },
          ]}
        />

        <Switch checked={encrypt} onChange={setEncrypt} label={t('wizard.encrypt')} />
        {encrypt && (
          <div className="col" style={{ gap: 'var(--space-3)' }}>
            <TextField
              label={t('wizard.password')}
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
            <TextField
              label={t('wizard.confirmPassword')}
              type="password"
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
            />
            <div className="auth-error">{t('wizard.encryptWarning')}</div>
          </div>
        )}

        {errorKey && (
          <div className="auth-error" role="alert">
            {t(errorKey)}
          </div>
        )}
      </form>
    </Dialog>
  );
}
