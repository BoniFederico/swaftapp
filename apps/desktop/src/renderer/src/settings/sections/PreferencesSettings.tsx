import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../../api-client/client';
import { useI18n } from '../../i18n/I18nProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, Select, useToast } from '../../ui';
import { ThemeControls } from '../ThemeControls';

type TreeDoubleClick = 'edit' | 'pin';

/**
 * PREFERENCES: theme, primary color, font, language + Working Tree behavior (app-level). Appearance
 * changes apply live (the providers are app-wide); Save consolidates everything — including the
 * Working Tree double-click choice, which only takes effect once saved — and confirms with a toast.
 */
export function PreferencesSettings({ client }: { client: ApiClient }) {
  const { t, language } = useI18n();
  const toast = useToast();
  const { mode, primaryColor, font } = useTheme();
  const [dblClick, setDblClick] = useState<TreeDoubleClick>('edit');
  // Snapshot of the last-persisted state, so Save enables only when something actually changed.
  const [saved, setSaved] = useState<string | null>(null);
  const seeded = useRef(false);

  const current = JSON.stringify([mode, primaryColor.key, font.key, language, dblClick]);

  useEffect(() => {
    void client
      .call('prefs.get')
      .then(({ preferences }) => {
        const dbl: TreeDoubleClick = preferences.treeDoubleClick === 'pin' ? 'pin' : 'edit';
        setDblClick(dbl);
        seeded.current = true;
      })
      .catch(() => {
        seeded.current = true;
      });
  }, [client]);

  // Seed the "saved" snapshot once the stored double-click preference has been applied.
  useEffect(() => {
    if (seeded.current && saved === null) setSaved(current);
  }, [current, saved]);

  async function save() {
    try {
      await client.call('prefs.set', {
        themeMode: mode,
        primaryColor: primaryColor.key,
        font: font.key,
        language,
        treeDoubleClick: dblClick,
      });
      setSaved(current);
      toast.show(t('toast.saved'), 'success');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  const dirty = saved !== null && saved !== current;

  return (
    <div className="settings-form">
      <ThemeControls />
      <div className="col" style={{ gap: 'var(--space-1)' }}>
        <Select
          label={t('settings.treeDoubleClick')}
          value={dblClick}
          onChange={(v) => setDblClick(v === 'pin' ? 'pin' : 'edit')}
          options={[
            { value: 'edit', label: t('settings.treeDoubleClick.edit') },
            { value: 'pin', label: t('settings.treeDoubleClick.pin') },
          ]}
        />
        <span className="field-hint">{t('settings.treeDoubleClickHint')}</span>
      </div>
      <div className="settings-form__actions">
        <Button variant="primary" disabled={!dirty} onClick={() => void save()}>
          {t('name.save')}
        </Button>
      </div>
    </div>
  );
}
