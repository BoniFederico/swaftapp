import { useEffect, useState } from 'react';
import type { TemplateType } from '@swaft/shared';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Dialog, Select, TextField } from '../ui';

/** Create-template dialog: name + type (document / render / API). */
export function CreateTemplateDialog({
  open,
  busy,
  onSubmit,
  onClose,
}: {
  open: boolean;
  busy?: boolean;
  onSubmit: (name: string, type: TemplateType) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [type, setType] = useState<TemplateType>('document');

  useEffect(() => {
    if (open) {
      setName('');
      setType('document');
    }
  }, [open]);

  function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    const n = name.trim();
    if (n) onSubmit(n, type);
  }

  return (
    <Dialog
      open={open}
      title={t('tree.createTemplate')}
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
        <TextField label={t('name.label')} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        <Select
          label={t('tpl.type')}
          value={type}
          onChange={(v) => setType(v as TemplateType)}
          options={[
            { value: 'document', label: t('tpl.document') },
            { value: 'api', label: t('tpl.api') },
            { value: 'capability', label: t('tpl.capability') },
          ]}
        />
      </form>
    </Dialog>
  );
}
