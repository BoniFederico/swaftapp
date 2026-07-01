import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Button, IconButton, TrashIcon } from '../ui';

export type BatchItem = { id: string; name: string };

/**
 * Batcher (M10, redesign): the user drags **document** templates from the Working Tree into the drop
 * zone to build an ordered batch. "Load inputs" then opens the batch in the main area to the right of
 * the Working Tree — exactly like opening one template, but with every template's inputs merged. The
 * batch list is owned by the parent (BatcherPanel). See SWAFT_UI_SPEC §16.
 */
export function BatcherView({
  items,
  onItemsChange,
  onLoadInputs,
}: {
  items: BatchItem[];
  onItemsChange: (next: BatchItem[]) => void;
  onLoadInputs: (templateIds: string[]) => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData('application/swaft-template');
    if (!raw) return;
    try {
      const tpl = JSON.parse(raw) as { id: string; name: string; type: string };
      if (tpl.type !== 'document') {
        setError(t('batch.onlyDocs'));
        return;
      }
      setError(null);
      if (!items.some((x) => x.id === tpl.id)) {
        onItemsChange([...items, { id: tpl.id, name: tpl.name }]);
      }
    } catch {
      /* ignore malformed payloads */
    }
  }

  function removeItem(id: string) {
    onItemsChange(items.filter((x) => x.id !== id));
  }

  return (
    <div className="col" style={{ gap: 'var(--space-4)' }}>
      <p className="muted batch-lead">{t('batch.lead')}</p>

      <div
        className={`batch-drop${dragOver ? ' batch-drop--over' : ''}`}
        data-testid="batch-drop"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {items.length === 0 ? (
          <p className="muted batch-drop__hint">{t('batch.dropHint')}</p>
        ) : (
          <ol className="batch-items">
            {items.map((it, i) => (
              <li key={it.id} className="batch-chip">
                <span className="batch-chip__n">{i + 1}</span>
                <span className="batch-chip__name">{it.name}</span>
                <IconButton label={t('batch.remove')} onClick={() => removeItem(it.id)}>
                  <TrashIcon />
                </IconButton>
              </li>
            ))}
          </ol>
        )}
      </div>

      <Button
        className="batch-load"
        onClick={() => onLoadInputs(items.map((i) => i.id))}
        disabled={items.length === 0}
      >
        {t('batch.build')}
      </Button>

      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
