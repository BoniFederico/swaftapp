import { useEffect, useState } from 'react';
import type { ApiClient } from '../../api-client/client';
import { useI18n } from '../../i18n/I18nProvider';
import { Select } from '../../ui';
import { ThemeControls } from '../ThemeControls';

type TreeDoubleClick = 'edit' | 'pin';

/** PREFERENCES: theme, primary color, font, language + Working Tree behavior (app-level). */
export function PreferencesSettings({ client }: { client: ApiClient }) {
  const { t } = useI18n();
  const [dblClick, setDblClick] = useState<TreeDoubleClick>('edit');

  useEffect(() => {
    void client
      .call('prefs.get')
      .then(({ preferences }) => {
        if (preferences.treeDoubleClick === 'pin') setDblClick('pin');
      })
      .catch(() => undefined);
  }, [client]);

  function setPref(v: TreeDoubleClick) {
    setDblClick(v);
    void client.call('prefs.set', { treeDoubleClick: v }).catch(() => undefined);
  }

  return (
    <div className="settings-form">
      <ThemeControls />
      <div className="col" style={{ gap: 'var(--space-1)' }}>
        <Select
          label={t('settings.treeDoubleClick')}
          value={dblClick}
          onChange={(v) => setPref(v === 'pin' ? 'pin' : 'edit')}
          options={[
            { value: 'edit', label: t('settings.treeDoubleClick.edit') },
            { value: 'pin', label: t('settings.treeDoubleClick.pin') },
          ]}
        />
        <span className="field-hint">{t('settings.treeDoubleClickHint')}</span>
      </div>
    </div>
  );
}
