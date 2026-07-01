import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ApiClient } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/catalogs';
import { GeneralSettings } from './sections/GeneralSettings';
import { PlaceholderSettings } from './sections/PlaceholderSettings';
import { PreferencesSettings } from './sections/PreferencesSettings';
import { RestrictionsSettings } from './sections/RestrictionsSettings';

type SectionId = 'general' | 'restrictions' | 'users' | 'groups' | 'preferences';

const NAV: { id: SectionId; label: TranslationKey }[] = [
  { id: 'general', label: 'set.general' },
  { id: 'restrictions', label: 'set.restrictions' },
  { id: 'users', label: 'set.users' },
  { id: 'groups', label: 'set.groups' },
  { id: 'preferences', label: 'set.preferences' },
];

/**
 * Workspace Settings, presented as an overlay modal (over the workspace, not inside it). Left nav
 * selects a section; the right pane shows it. GENERAL / RESTRICTIONS / PREFERENCES are functional;
 * USERS and GROUPS & PERMISSIONS are placeholders pending collaboration/server mode (post-MVP).
 */
export function SettingsModal({
  open,
  onClose,
  client,
}: {
  open: boolean;
  onClose: () => void;
  client: ApiClient;
}) {
  const { t } = useI18n();
  const [section, setSection] = useState<SectionId>('general');

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="settings-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label={t('wsset.title')}>
        <header className="settings-modal__head">
          <span className="settings-modal__title">{t('wsset.title')}</span>
          <button type="button" className="settings-modal__close" aria-label={t('name.cancel')} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="settings-modal__body">
          <nav className="settings-nav">
            {NAV.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`settings-nav__item${section === n.id ? ' is-active' : ''}`}
                onClick={() => setSection(n.id)}
              >
                {t(n.label)}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {section === 'general' && <GeneralSettings client={client} />}
            {section === 'restrictions' && <RestrictionsSettings client={client} />}
            {section === 'users' && (
              <PlaceholderSettings titleKey="set.users" hintKey="set.usersHint" />
            )}
            {section === 'groups' && (
              <PlaceholderSettings titleKey="set.groups" hintKey="set.groupsHint" />
            )}
            {section === 'preferences' && <PreferencesSettings />}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
