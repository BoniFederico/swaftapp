import { createPortal } from 'react-dom';
import type { ProjectDto } from '@swaft/shared';
import { useI18n } from '../i18n/I18nProvider';
import { CloseIcon, IconButton } from '../ui';
import { usePopover } from '../ui/usePopover';

/**
 * Project picker shown next to the Working Tree title: selects the active project (a filter), deletes
 * a project via the per-row × (confirmed by the caller), and, as its last item, opens the
 * create-project flow. Portalled popup so it anchors to the trigger.
 */
export function ProjectSelector({
  projects,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
}: {
  projects: ProjectDto[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: () => void;
  onDelete: (project: ProjectDto) => void;
}) {
  const { t } = useI18n();
  const { open, setOpen, pos, triggerRef, popRef, toggle } = usePopover<HTMLDivElement>();
  const selected = projects.find((p) => p.id === selectedId);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="project-select"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('tree.selectProject')}
        onClick={toggle}
      >
        <span>{selected ? selected.name : t('tree.selectProject')}</span>
        <span className="ui-select__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            role="menu"
            className="ui-menu"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: pos.width,
              minWidth: pos.width,
            }}
          >
            {projects.map((p) => (
              <div key={p.id} className="project-row" role="presentation">
                <button
                  type="button"
                  role="menuitem"
                  className="ui-menu__item project-row__name"
                  onClick={() => {
                    setOpen(false);
                    onSelect(p.id);
                  }}
                >
                  {p.name}
                </button>
                <IconButton
                  label={t('confirm.deleteProjectShort', { name: p.name })}
                  className="project-row__del"
                  onClick={() => {
                    setOpen(false);
                    onDelete(p);
                  }}
                >
                  <CloseIcon />
                </IconButton>
              </div>
            ))}
            <div className="ui-menu__sep" />
            <button
              type="button"
              role="menuitem"
              className="ui-menu__item ui-menu__item--accent"
              onClick={() => {
                setOpen(false);
                onCreate();
              }}
            >
              {t('tree.createProject')}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
