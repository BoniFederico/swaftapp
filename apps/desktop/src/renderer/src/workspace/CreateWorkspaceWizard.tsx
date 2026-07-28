import { useState } from 'react';
import type { ExecutionMode, StorageMode } from '@swaft/shared';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/catalogs';
import { Button, Dialog, Select, Switch, TextField } from '../ui';
import { useWorkspace } from './WorkspaceProvider';
import { workspaceErrorKey } from './workspace-errors';

/**
 * How a new workspace is materialized on disk. All three are immutable for the workspace's life:
 * - `local-file`: a single (optionally encrypted) `.swaft` file (storage mode `local`).
 * - `local-folder`: a plain directory of readable files (storage mode `local`, never encrypted).
 * - `git`: a directory of versioned files in a Git repository (never encrypted).
 */
export type CreateVariant = 'local-file' | 'local-folder' | 'git';

/**
 * Create Workspace wizard. The variant is chosen up front on the homepage (the Create split-button)
 * and passed in here. `local-file` picks a `.swaft` save path and can be encrypted; `local-folder`
 * and `git` pick a directory and are stored as plain files. Execution mode defaults to `sandbox`.
 */
export function CreateWorkspaceWizard({
  open,
  variant,
  onClose,
}: {
  open: boolean;
  variant: CreateVariant;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { create, busy, errorCode, clearError, pickCreateTarget, pickDirectory } = useWorkspace();

  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('sandbox');
  const [localError, setLocalError] = useState<TranslationKey | null>(null);

  const isGit = variant === 'git';
  // Both folder-backed forms pick a directory and are stored as plain files; only the single-file
  // `.swaft` can be encrypted.
  const isFile = variant === 'local-file';
  const storageMode: StorageMode = isGit ? 'git' : 'local';

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
    const path = isFile ? await pickCreateTarget(name) : await pickDirectory();
    if (path) setLocation(path);
  }

  async function onSubmit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setLocalError(null);
    clearError();
    const encrypting = encrypt && isFile;
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

        <div className="ui-field">
          <span className="ui-field__label">{t('wizard.storageMode')}</span>
          <div className="wizard__mode">
            <span className="ui-badge">
              {isGit
                ? t('wizard.storageModeGit')
                : isFile
                  ? t('wizard.storageModeLocal')
                  : t('wizard.storageModeFolder')}
            </span>
            <span className="field-hint">
              {isGit
                ? t('wizard.storageGitHint')
                : isFile
                  ? t('wizard.storageImmutable')
                  : t('wizard.storageFolderHint')}
            </span>
          </div>
        </div>

        <div className="ui-field">
          <span className="ui-field__label">
            {isFile ? t('wizard.location') : t('wizard.locationFolder')}
          </span>
          <div className="row">
            <Button type="button" variant="secondary" onClick={chooseLocation}>
              {isFile ? t('wizard.chooseLocation') : t('wizard.chooseFolder')}
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

        {isFile && <Switch checked={encrypt} onChange={setEncrypt} label={t('wizard.encrypt')} />}
        {isFile && encrypt && (
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
