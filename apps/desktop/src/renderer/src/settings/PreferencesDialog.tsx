import { useI18n } from '../i18n/I18nProvider';
import { Button, Dialog } from '../ui';
import { ThemeControls } from './ThemeControls';

/** App-level preferences (theme / primary color / language). Reachable from any signed-in screen. */
export function PreferencesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      title={t('prefs.title')}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('prefs.close')}
        </Button>
      }
    >
      <ThemeControls />
    </Dialog>
  );
}
