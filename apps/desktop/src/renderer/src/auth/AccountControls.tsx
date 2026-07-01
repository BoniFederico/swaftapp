import { useI18n } from '../i18n/I18nProvider';
import { IconButton, LockIcon, LogoutIcon } from '../ui';
import { useAuth } from './AuthProvider';

/** Header account controls: signed-in identity + Lock / Sign out. Reused across signed-in screens. */
export function AccountControls() {
  const { t } = useI18n();
  const { profile, lock, signOut } = useAuth();

  return (
    <div className="account">
      <span className="muted">{t('home.signedInAs', { name: profile?.displayName ?? '' })}</span>
      <IconButton label={t('account.lock')} onClick={() => void lock()}>
        <LockIcon />
      </IconButton>
      <IconButton label={t('account.signOut')} onClick={() => void signOut()}>
        <LogoutIcon />
      </IconButton>
    </div>
  );
}
