import { useEffect, useState } from 'react';
import { isCodeTemplateType, type TemplateType } from '@swaft/shared';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Dialog, Select, TextField } from '../ui';

/** Capability/action names are referenced like a function, so they must be JS identifiers. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Create-template dialog: name + type (document / API / capability / action). */
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

  // Code kinds are called by their name, so it must be a valid identifier — checked live rather than
  // letting the create fail server-side (which used to look like nothing happening).
  const trimmed = name.trim();
  const needsIdentifier = isCodeTemplateType(type);
  const badName = needsIdentifier && trimmed.length > 0 && !IDENTIFIER.test(trimmed);
  const canSubmit = trimmed.length > 0 && !badName;

  function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (canSubmit) onSubmit(trimmed, type);
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
          <Button variant="primary" disabled={busy || !canSubmit} onClick={submit}>
            {t('name.create')}
          </Button>
        </>
      }
    >
      <form className="col" style={{ gap: 'var(--space-4)' }} onSubmit={submit}>
        <div className="col" style={{ gap: 'var(--space-1)' }}>
          <TextField label={t('name.label')} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          {needsIdentifier && (
            <span className={badName ? 'field-hint field-hint--error' : 'field-hint'}>
              {t('tpl.codeNameHint')}
            </span>
          )}
        </div>
        <Select
          label={t('tpl.type')}
          value={type}
          onChange={(v) => setType(v as TemplateType)}
          options={[
            { value: 'document', label: t('tpl.document') },
            { value: 'api', label: t('tpl.api') },
            { value: 'capability', label: t('tpl.capability') },
            { value: 'action', label: t('tpl.action') },
          ]}
        />
      </form>
    </Dialog>
  );
}
