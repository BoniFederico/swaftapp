import { useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { ChevronIcon, ClearIcon, IconButton } from '../ui';
import { BatcherView, type BatchItem } from './BatcherView';

const MIN_H = 140;
const MAX_H = 640;

/**
 * The Batcher docked at the bottom of the left sidebar (like Source Control's Graph/GitLens panels):
 * a header with a chevron to open/close + a clear action, and a top edge you can drag upward to
 * resize. The batch list lives here so it survives open/close and the clear button. See item 4.
 */
export function BatcherPanel({
  onLoadInputs,
}: {
  onLoadInputs: (templateIds: string[]) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(300);
  const [items, setItems] = useState<BatchItem[]>([]);
  const drag = useRef<{ startY: number; startH: number } | null>(null);

  function onResizeDown(e: React.PointerEvent) {
    e.preventDefault();
    drag.current = { startY: e.clientY, startH: height };
    const onMove = (ev: PointerEvent) => {
      if (!drag.current) return;
      const next = drag.current.startH + (drag.current.startY - ev.clientY);
      setHeight(Math.min(MAX_H, Math.max(MIN_H, next)));
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return (
    <section
      className={`batch-panel${open ? ' batch-panel--open' : ''}`}
      style={open ? { height } : undefined}
      aria-label={t('batch.menu')}
    >
      {open && <div className="batch-panel__resizer" onPointerDown={onResizeDown} />}
      <div className="batch-panel__head">
        <button
          type="button"
          className="batch-panel__toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span>{t('batch.menu')}</span>
          {items.length > 0 && <span className="batch-panel__count">{items.length}</span>}
        </button>
        <div className="batch-panel__tools">
          {items.length > 0 && (
            <IconButton label={t('batch.clear')} onClick={() => setItems([])}>
              <ClearIcon />
            </IconButton>
          )}
          <IconButton
            label={open ? t('tree.collapse') : t('tree.expand')}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronIcon className={`batch-panel__chev${open ? ' batch-panel__chev--up' : ''}`} />
          </IconButton>
        </div>
      </div>
      {open && (
        <div className="batch-panel__body">
          <BatcherView items={items} onItemsChange={setItems} onLoadInputs={onLoadInputs} />
        </div>
      )}
    </section>
  );
}
