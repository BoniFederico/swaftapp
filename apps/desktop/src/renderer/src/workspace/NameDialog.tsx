import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Dialog, TextField } from '../ui';

/** Single-field name dialog, shared by create/rename flows in the Working Tree. */
export function NameDialog({
  open,
  title,
  submitLabel,
  initialValue = '',
  busy,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  initialValue?: string;
  busy?: boolean;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    const name = value.trim();
    if (name) onSubmit(name);
  }

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('name.cancel')}
          </Button>
          <Button variant="primary" disabled={busy || !value.trim()} onClick={submit}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <TextField
          label={t('name.label')}
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
        />
      </form>
    </Dialog>
  );
}
