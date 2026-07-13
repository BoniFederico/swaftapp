import { createPortal } from 'react-dom';
import type { EnvironmentSummaryDto } from '@swaft/shared';
import { useI18n } from '../i18n/I18nProvider';
import { usePopover } from '../ui/usePopover';
import { useEnvironments } from './EnvironmentProvider';
import { OWNER_KIND_LABEL } from './ownerKind';

/** The small ownership badge (Personal / Workspace / Project · Name) shown next to an env name. */
function OwnerBadge({ env }: { env: EnvironmentSummaryDto }) {
  const { t } = useI18n();
  const label = t(OWNER_KIND_LABEL[env.ownerKind]);
  return (
    <span className={`ui-badge env-badge env-badge--${env.ownerKind}`}>
      {env.ownerKind === 'project' && env.ownerName ? `${label} · ${env.ownerName}` : label}
    </span>
  );
}

/**
 * Header control that shows the active environment (name + ownership badge) or a "select" placeholder,
 * and opens a listbox of every environment — each with its type badge. A trailing "Manage
 * environments…" item opens the settings Environments section. Sits next to the Settings button.
 */
export function EnvironmentPicker({ onManage }: { onManage: () => void }) {
  const { t } = useI18n();
  const { environments, activeId, active, setActive } = useEnvironments();
  const { open, setOpen, pos, triggerRef, popRef, toggle } = usePopover<HTMLDivElement>(260);

  function choose(id: string | null) {
    void setActive(id);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`env-picker__trigger${active ? '' : ' is-empty'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('env.picker.label')}
        onClick={toggle}
      >
        {active ? (
          <>
            <span className="env-picker__name">{active.name}</span>
            <OwnerBadge env={active} />
          </>
        ) : (
          <span className="env-picker__placeholder">{t('env.picker.placeholder')}</span>
        )}
        <span className="env-picker__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="env-menu"
            role="listbox"
            aria-label={t('env.picker.label')}
            style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: Math.max(pos.width, 260) }}
          >
            {environments.length === 0 ? (
              <div className="env-menu__empty">{t('env.picker.empty')}</div>
            ) : (
              <ul className="env-menu__list">
                {activeId && (
                  <li role="option" aria-selected={false}>
                    <button type="button" className="env-menu__item env-menu__item--muted" onClick={() => choose(null)}>
                      {t('env.picker.none')}
                    </button>
                  </li>
                )}
                {environments.map((env) => (
                  <li key={env.id} role="option" aria-selected={env.id === activeId}>
                    <button
                      type="button"
                      className={`env-menu__item${env.id === activeId ? ' is-active' : ''}`}
                      onClick={() => choose(env.id)}
                    >
                      <span className="env-menu__name">{env.name}</span>
                      <OwnerBadge env={env} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="env-menu__sep" role="separator" />
            <button
              type="button"
              className="env-menu__item env-menu__manage"
              onClick={() => {
                setOpen(false);
                onManage();
              }}
            >
              {t('env.picker.manage')}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
