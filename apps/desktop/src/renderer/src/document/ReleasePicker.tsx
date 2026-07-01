import { createPortal } from 'react-dom';
import { DRAFT_RELEASE, type ReleaseDto } from '@swaft/shared';
import { useI18n } from '../i18n/I18nProvider';
import { CloseIcon, IconButton } from '../ui';
import { usePopover } from '../ui/usePopover';

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Release picker: a dropdown showing Draft + each release with its last-modified date (small) and a
 * delete (×) affordance. Selection drives the editor + the rendered output. Reusable popover styling.
 */
export function ReleasePicker({
  releases,
  selection,
  draftDate,
  onSelect,
  onDelete,
}: {
  releases: ReleaseDto[];
  selection: string;
  /** The Draft's date (= template creation), or null when the draft has been deleted. */
  draftDate: string | null;
  onSelect: (id: string) => void;
  onDelete: (target: ReleaseDto | 'draft') => void;
}) {
  const { t } = useI18n();
  const { open, setOpen, pos, triggerRef, popRef, toggle } = usePopover<HTMLDivElement>(280);
  const currentLabel =
    selection === DRAFT_RELEASE
      ? t('editor.draft')
      : (releases.find((r) => r.id === selection)?.name ?? t('editor.draft'));

  function choose(id: string) {
    setOpen(false);
    onSelect(id);
  }
  function requestDelete(target: ReleaseDto | 'draft') {
    setOpen(false);
    onDelete(target);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ui-select release-picker"
        aria-label={t('editor.release')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
      >
        <span>{currentLabel}</span>
        <span className="ui-select__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            className="ui-menu release-menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
          >
            {draftDate !== null && (
              <div className="release-row" role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selection === DRAFT_RELEASE}
                  className="release-opt"
                  onClick={() => choose(DRAFT_RELEASE)}
                >
                  <span className="release-opt__name">{t('editor.draft')}</span>
                  <span className="release-opt__date muted">{shortDate(draftDate)}</span>
                </button>
                <IconButton label={t('editor.deleteDraft')} onClick={() => requestDelete('draft')}>
                  <CloseIcon />
                </IconButton>
              </div>
            )}
            {releases.map((r) => (
              <div key={r.id} className="release-row" role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selection === r.id}
                  className="release-opt"
                  onClick={() => choose(r.id)}
                >
                  <span className="release-opt__name">{r.name}</span>
                  <span className="release-opt__date muted">{shortDate(r.updatedAt)}</span>
                </button>
                <IconButton
                  label={t('editor.deleteRelease', { name: r.name })}
                  onClick={() => requestDelete(r)}
                >
                  <CloseIcon />
                </IconButton>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
