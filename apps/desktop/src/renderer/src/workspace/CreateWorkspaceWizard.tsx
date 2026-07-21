import { useState } from 'react';
import type { ExecutionMode, StorageMode } from '@swaft/shared';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/catalogs';
import { Button, Dialog, Select, Switch, TextField } from '../ui';
import { useWorkspace } from './WorkspaceProvider';
import { workspaceErrorKey } from './workspace-errors';

/**
 * Create Workspace wizard (SWAFT_UI_SPEC.md §3). The storage mode is chosen at creation and immutable:
 * `local` is a single (optionally encrypted) `.swaft` file; `git` is a directory of versioned files in
 * a Git repository (never encrypted — see git.md). Execution mode defaults to `sandbox`.
 */
export function CreateWorkspaceWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { create, busy, errorCode, clearError, pickCreateTarget, pickDirectory } = useWorkspace();

  const [name, setName] = useState('');
  const [storageMode, setStorageMode] = useState<StorageMode>('local');
  const [location, setLocation] = useState('');
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('sandbox');
  const [localError, setLocalError] = useState<TranslationKey | null>(null);

  const isGit = storageMode === 'git';

  function reset() {
    setName('');
    setStorageMode('local');
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

  function changeMode(mode: StorageMode) {
    setStorageMode(mode);
    setLocation(''); // a file path and a directory are not interchangeable
    if (mode === 'git') setEncrypt(false); // git workspaces are plain files
  }

  async function chooseLocation() {
    const path = isGit ? await pickDirectory() : await pickCreateTarget(name);
    if (path) setLocation(path);
  }

  async function onSubmit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setLocalError(null);
    clearError();
    const encrypting = encrypt && !isGit;
    if (encrypting) {
      if (password.length < 8) return setLocalError('auth.error.tooShort');
      if (password !== confirm) return setLocalError('auth.error.mismatch');
    }
    try {
      await create({
        name: name.trim(),
        storageMode,
        location,
        encrypt: encrypting,
        password: encrypting ? password : undefined,
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

        <Select
          label={t('wizard.storageMode')}
          value={storageMode}
          onChange={(v) => changeMode(v as StorageMode)}
          options={[
            { value: 'local', label: t('wizard.storageModeLocal') },
            { value: 'git', label: t('wizard.storageModeGit') },
          ]}
        />
        <div className="field-hint">
          {isGit ? t('wizard.storageGitHint') : t('wizard.storageImmutable')}
        </div>

        <div className="ui-field">
          <span className="ui-field__label">
            {isGit ? t('wizard.locationFolder') : t('wizard.location')}
          </span>
          <div className="row">
            <Button type="button" variant="secondary" onClick={chooseLocation}>
              {isGit ? t('wizard.chooseFolder') : t('wizard.chooseLocation')}
            </Button>
            <span className="muted" data-testid="wizard-location">
              {location || t('wizard.noLocation')}
            </span>
          </div>
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

        {!isGit && <Switch checked={encrypt} onChange={setEncrypt} label={t('wizard.encrypt')} />}
        {!isGit && encrypt && (
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
