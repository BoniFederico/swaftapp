import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ApiClient } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import { useFocusTrap } from '../ui';
import type { TranslationKey } from '../i18n/catalogs';
import { EnvironmentsNav } from './sections/EnvironmentsNav';
import { EnvironmentsSettings } from './sections/EnvironmentsSettings';
import { GeneralSettings } from './sections/GeneralSettings';
import { PreferencesSettings } from './sections/PreferencesSettings';
import { RestrictionsSettings } from './sections/RestrictionsSettings';

export type SettingsSectionId = 'general' | 'restrictions' | 'environments' | 'preferences';

const NAV: { id: SettingsSectionId; label: TranslationKey }[] = [
  { id: 'general', label: 'set.general' },
  { id: 'restrictions', label: 'set.restrictions' },
  { id: 'environments', label: 'set.environments' },
  { id: 'preferences', label: 'set.preferences' },
];

// Resizable nav column (persisted); clamped so neither pane collapses.
const NAV_MIN = 180;
const NAV_MAX = 360;
const NAV_DEFAULT = 224;
const MIN_CONTENT = 340;
const NAV_W_KEY = 'swaft:settingsNavW';

/**
 * Workspace Settings, presented as an overlay modal (over the workspace, not inside it). Left nav
 * selects a section; the right pane shows it.
 */
export function SettingsModal({
  open,
  onClose,
  client,
  initialSection,
  sections,
}: {
  open: boolean;
  onClose: () => void;
  client: ApiClient;
  /** Section to show when the modal opens (e.g. "Manage environments…" → 'environments'). */
  initialSection?: SettingsSectionId;
  /**
   * Restrict which sections are available (in order). Defaults to all. Used by the homepage to show
   * only 'preferences' — the same Settings modal, minus the workspace-scoped sections. The left nav
   * is always rendered (even with a single item) so the layout stays identical across shells.
   */
  sections?: SettingsSectionId[];
}) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSectionId>('general');
  const modalRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, open);

  // Persisted, resizable nav column. Seed once from storage (clamped) so persisting can't race a load.
  const [navWidth, setNavWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(NAV_W_KEY));
    return Number.isFinite(stored) && stored > 0
      ? Math.max(NAV_MIN, Math.min(NAV_MAX, stored))
      : NAV_DEFAULT;
  });
  useEffect(() => {
    localStorage.setItem(NAV_W_KEY, String(navWidth));
  }, [navWidth]);

  function onNavResize(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = navWidth;
    const bodyW = bodyRef.current?.getBoundingClientRect().width ?? 900;
    const max = Math.max(NAV_MIN, Math.min(NAV_MAX, bodyW - MIN_CONTENT));
    const onMove = (ev: PointerEvent) => {
      setNavWidth(Math.max(NAV_MIN, Math.min(max, startW + (ev.clientX - startX))));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const nav = sections ? NAV.filter((n) => sections.includes(n.id)) : NAV;
  // Keep the shown section within the allowed set, falling back to the first available one.
  const active = nav.some((n) => n.id === section) ? section : (nav[0]?.id ?? 'general');

  // Environments is a two-level section: the nav lists the environments (+ "add new") and the content
  // shows the selected one's detail, so the selection is shared across both columns here.
  const [envSelectedId, setEnvSelectedId] = useState<string | null>(null);
  const [envCreating, setEnvCreating] = useState(false);
  const selectEnv = useCallback((id: string) => {
    setEnvCreating(false);
    setEnvSelectedId(id);
  }, []);
  const createNewEnv = useCallback(() => {
    setEnvCreating(true);
    setEnvSelectedId(null);
  }, []);

  // Jump to the requested section each time the modal is (re)opened.
  useEffect(() => {
    if (open && initialSection) setSection(initialSection);
  }, [open, initialSection]);

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
      <div
        ref={modalRef}
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('wsset.title')}
        tabIndex={-1}
      >
        <header className="settings-modal__head">
          <span className="settings-modal__title">{t('wsset.title')}</span>
          <button type="button" className="settings-modal__close" aria-label={t('name.cancel')} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="settings-modal__body" ref={bodyRef}>
          {/* The nav is always shown — even a single allowed section (homepage → Preferences) keeps
              the same two-pane Settings layout for visual consistency. */}
          <nav className="settings-nav" style={{ width: navWidth }}>
            {nav.map((n) => (
              <div key={n.id} className="settings-nav__entry">
                <button
                  type="button"
                  className={`settings-nav__item${active === n.id ? ' is-active' : ''}`}
                  onClick={() => setSection(n.id)}
                >
                  {t(n.label)}
                </button>
                {n.id === 'environments' && active === 'environments' && (
                  <EnvironmentsNav
                    selectedId={envSelectedId}
                    creating={envCreating}
                    onSelect={selectEnv}
                    onCreateNew={createNewEnv}
                  />
                )}
              </div>
            ))}
          </nav>
          <div
            className="settings-split"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('set.resize')}
            onPointerDown={onNavResize}
          />
          <div className="settings-content">
            {/* A centered, fixed-width column so every section has equal side margins and its
                Save/Cancel bar lands at the same bottom-aligned position. */}
            <div className="settings-content__inner">
              {active === 'general' && <GeneralSettings />}
              {active === 'restrictions' && <RestrictionsSettings client={client} />}
              {active === 'environments' && (
                <EnvironmentsSettings
                  client={client}
                  selectedId={envSelectedId}
                  creating={envCreating}
                  onSelect={selectEnv}
                  onCancelCreate={() => setEnvCreating(false)}
                  onDeleted={() => setEnvSelectedId(null)}
                />
              )}
              {active === 'preferences' && <PreferencesSettings client={client} />}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
