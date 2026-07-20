import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { Button, TextField, useToast } from '../../ui';

/** GENERAL settings: workspace name + icon. (Tags are managed inline in the Template Editor.) */
export function GeneralSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const { current, update } = useWorkspace();
  const [name, setName] = useState(current?.name ?? '');
  const [icon, setIcon] = useState(current?.icon ?? '');

  async function save() {
    try {
      await update({ name: name.trim(), icon: icon.trim() || null });
      toast.show(t('toast.saved'), 'success');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  const dirty =
    name.trim() !== (current?.name ?? '') || (icon.trim() || null) !== (current?.icon ?? null);

  return (
    <div className="settings-form">
      <TextField label={t('gen.name')} value={name} onChange={(e) => setName(e.target.value)} />
      <TextField
        label={t('gen.icon')}
        placeholder={t('gen.iconPlaceholder')}
        value={icon}
        onChange={(e) => setIcon(e.target.value)}
      />
      <div className="settings-form__actions">
        <Button
          variant="ghost"
          disabled={!dirty}
          onClick={() => {
            setName(current?.name ?? '');
            setIcon(current?.icon ?? '');
          }}
        >
          {t('name.cancel')}
        </Button>
        <Button variant="primary" disabled={!name.trim() || !dirty} onClick={() => void save()}>
          {t('wsset.save')}
        </Button>
      </div>
    </div>
  );
}
