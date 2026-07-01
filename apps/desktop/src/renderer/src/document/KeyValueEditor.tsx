import { useState } from 'react';
import { SeeboField } from '../editor/SeeboField';
import { useI18n } from '../i18n/I18nProvider';
import { CopyIcon, IconButton, TrashIcon } from '../ui';

type Pair = { k: string; v: string };

/** Serialize non-empty pairs to `key: value` lines for the batch editor. */
function toText(pairs: Pair[]): string {
  return pairs
    .filter((p) => p.k.trim() || p.v.trim())
    .map((p) => `${p.k}: ${p.v}`)
    .join('\n');
}
/** Parse `key: value` lines back to a record (splitting on the first colon). */
function fromText(text: string): Record<string, string> {
  const rec: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    const k = (i === -1 ? line : line.slice(0, i)).trim();
    const v = i === -1 ? '' : line.slice(i + 1).trim();
    if (k) rec[k] = v;
  }
  return rec;
}

/**
 * A key/value editor (request params / headers) with two modes: a row table (default) and a **batch**
 * textarea (`key: value`, one per line). A toggle switches between them, preserving edits both ways.
 */
export function KeyValueEditor({
  value,
  onChange,
  onCopy,
}: {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  /** Copy the entries as `key: value` lines. */
  onCopy?: (text: string) => void;
}) {
  const { t } = useI18n();
  const [batch, setBatch] = useState(false);
  // Raw text the bulk editor shows — kept separate from `pairs` so re-parsing never fights the cursor.
  const [batchText, setBatchText] = useState('');
  const [pairs, setPairs] = useState<Pair[]>(() => {
    const seed = Object.entries(value).map(([k, v]) => ({ k, v }));
    return [...seed, { k: '', v: '' }];
  });

  function toggleBatch() {
    if (!batch) setBatchText(toText(pairs)); // entering batch: seed from the current pairs
    setBatch((b) => !b);
  }

  function commit(next: Pair[]) {
    const trimmed = next.filter((p, i) => p.k !== '' || p.v !== '' || i === next.length - 1);
    if (
      trimmed.length === 0 ||
      trimmed[trimmed.length - 1]!.k !== '' ||
      trimmed[trimmed.length - 1]!.v !== ''
    ) {
      trimmed.push({ k: '', v: '' });
    }
    setPairs(trimmed);
    const rec: Record<string, string> = {};
    for (const p of trimmed) if (p.k.trim()) rec[p.k.trim()] = p.v;
    onChange(rec);
  }

  function setAt(i: number, patch: Partial<Pair>) {
    commit(pairs.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function removeAt(i: number) {
    commit(pairs.filter((_, idx) => idx !== i));
  }

  function applyBatch(text: string) {
    const rec = fromText(text);
    setPairs([...Object.entries(rec).map(([k, v]) => ({ k, v })), { k: '', v: '' }]);
    onChange(rec);
  }

  return (
    <div className="kv">
      <div className="kv__toolbar">
        <button type="button" className="kv__mode" onClick={toggleBatch}>
          {batch ? t('api.tableEdit') : t('api.batchEdit')}
        </button>
        {onCopy && (
          <IconButton label={t('doc.copy')} onClick={() => onCopy(toText(pairs))}>
            <CopyIcon />
          </IconButton>
        )}
      </div>

      {batch ? (
        // Highlights ${ … } formulas in the values, like the table-mode value editor.
        <SeeboField
          multiline
          ariaLabel={t('api.batchEdit')}
          placeholder="key: value"
          value={batchText}
          onChange={(text) => {
            setBatchText(text);
            applyBatch(text);
          }}
        />
      ) : (
        pairs.map((p, i) => {
          const isTrailing = i === pairs.length - 1;
          return (
            <div className="kv__row" key={i}>
              <input
                className="ui-input"
                aria-label={t('api.key')}
                placeholder={t('api.key')}
                value={p.k}
                onChange={(e) => setAt(i, { k: e.target.value })}
              />
              {/* Values may carry Seebo formulas (`${ … }`) → a single-line editor that highlights them. */}
              <SeeboField
                ariaLabel={t('api.value')}
                placeholder={t('api.value')}
                value={p.v}
                onChange={(v) => setAt(i, { v })}
              />
              {!isTrailing ? (
                <IconButton label={t('menu.delete')} onClick={() => removeAt(i)}>
                  <TrashIcon />
                </IconButton>
              ) : (
                <span className="kv__spacer" />
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
