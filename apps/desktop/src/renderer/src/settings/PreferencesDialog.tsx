import { useEffect, useRef } from 'react';
import { api } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import type { LanguageCode } from '../i18n/catalogs';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Dialog, useToast } from '../ui';
import { ThemeControls } from './ThemeControls';

/**
 * App-level preferences (theme / primary color / font / language), reachable from any signed-in
 * screen. The controls apply live as a preview; nothing is persisted until Save. Cancel (and the
 * dialog's own close) restores the snapshot taken when the dialog opened.
 */
export function PreferencesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, language, setLanguage } = useI18n();
  const toast = useToast();
  const { mode, setMode, primaryColor, setPrimaryColor, font, setFont } = useTheme();
  const snapshot = useRef<{
    mode: typeof mode;
    primaryColor: typeof primaryColor;
    font: typeof font;
    language: LanguageCode;
  } | null>(null);

  // Snapshot the live state each time the dialog opens, so Cancel can put it back.
  useEffect(() => {
    if (open) snapshot.current = { mode, primaryColor, font, language };
    // Deliberately keyed on `open` alone: re-snapshotting on a previewed change would lose the
    // original state Cancel has to restore.
  }, [open]);

  function cancel() {
    const snap = snapshot.current;
    if (snap) {
      setMode(snap.mode);
      setPrimaryColor(snap.primaryColor);
      setFont(snap.font);
      setLanguage(snap.language);
    }
    onClose();
  }

  async function save() {
    try {
      await api.call('prefs.set', {
        themeMode: mode,
        primaryColor: primaryColor.key,
        font: font.key,
        language,
      });
      toast.show(t('toast.saved'), 'success');
      onClose();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  return (
    <Dialog
      open={open}
      title={t('prefs.title')}
      onClose={cancel}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            {t('name.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            {t('name.save')}
          </Button>
        </>
      }
    >
      <ThemeControls />
    </Dialog>
  );
}
