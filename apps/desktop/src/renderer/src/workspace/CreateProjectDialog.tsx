import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Dialog, TextField } from '../ui';

/** Create-project dialog: name + an optional description (shown under the active project name). */
export function CreateProjectDialog({
  open,
  busy,
  onSubmit,
  onClose,
}: {
  open: boolean;
  busy?: boolean;
  onSubmit: (name: string, description: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
    }
  }, [open]);

  function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    const n = name.trim();
    if (n) onSubmit(n, description.trim());
  }

  return (
    <Dialog
      open={open}
      title={t('tree.createProject')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('name.cancel')}
          </Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={submit}>
            {t('name.create')}
          </Button>
        </>
      }
    >
      <form className="col" style={{ gap: 'var(--space-4)' }} onSubmit={submit}>
        <TextField
          label={t('name.label')}
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        <div className="ui-field">
          <span className="ui-field__label">{t('project.description')}</span>
          <textarea
            className="ui-input"
            rows={3}
            value={description}
            aria-label={t('project.description')}
            placeholder={t('project.descriptionHint')}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </form>
    </Dialog>
  );
}
