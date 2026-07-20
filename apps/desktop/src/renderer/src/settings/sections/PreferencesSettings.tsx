import { useEffect, useState } from 'react';
import type { ApiClient } from '../../api-client/client';
import { useI18n } from '../../i18n/I18nProvider';
import type { LanguageCode } from '../../i18n/catalogs';
import type { FontOption, PrimaryColor } from '../../theme/palette';
import { useTheme, type ThemeMode } from '../../theme/ThemeProvider';
import { Button, Select, useToast } from '../../ui';
import { ThemeControls } from '../ThemeControls';

type TreeDoubleClick = 'edit' | 'pin';

interface Snapshot {
  mode: ThemeMode;
  primaryColor: PrimaryColor;
  font: FontOption;
  language: LanguageCode;
  dblClick: TreeDoubleClick;
}

/**
 * PREFERENCES: theme, primary color, font, language + Working Tree behavior (app-level).
 *
 * Appearance changes apply live because the providers are app-wide, but that is only a *preview* —
 * nothing is persisted until Save. Cancel puts the previewed controls back to the stored state.
 */
export function PreferencesSettings({ client }: { client: ApiClient }) {
  const { t, language, setLanguage } = useI18n();
  const toast = useToast();
  const { mode, setMode, primaryColor, setPrimaryColor, font, setFont } = useTheme();
  const [dblClick, setDblClick] = useState<TreeDoubleClick>('edit');
  // The last-persisted state, so Save enables only when something actually changed.
  const [saved, setSaved] = useState<Snapshot | null>(null);

  const current: Snapshot = { mode, primaryColor, font, language, dblClick };

  useEffect(() => {
    void client
      .call('prefs.get')
      .then(({ preferences }) => {
        const dbl: TreeDoubleClick = preferences.treeDoubleClick === 'pin' ? 'pin' : 'edit';
        setDblClick(dbl);
        // Seed from the live providers (already hydrated app-wide) plus the stored double-click.
        setSaved({ mode, primaryColor, font, language, dblClick: dbl });
      })
      .catch(() => setSaved({ mode, primaryColor, font, language, dblClick: 'edit' }));
    // Seed once per client: re-running on a previewed change would defeat the dirty check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

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

  function cancel() {
    if (!saved) return;
    setMode(saved.mode);
    setPrimaryColor(saved.primaryColor);
    setFont(saved.font);
    setLanguage(saved.language);
    setDblClick(saved.dblClick);
  }

  const dirty =
    saved !== null &&
    (saved.mode !== mode ||
      saved.primaryColor.key !== primaryColor.key ||
      saved.font.key !== font.key ||
      saved.language !== language ||
      saved.dblClick !== dblClick);

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
        <Button variant="ghost" disabled={!dirty} onClick={cancel}>
          {t('name.cancel')}
        </Button>
        <Button variant="primary" disabled={!dirty} onClick={() => void save()}>
          {t('name.save')}
        </Button>
      </div>
    </div>
  );
}
