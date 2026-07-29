import { useEffect, useRef, useState } from 'react';
import { SeeboField } from '../editor/SeeboField';
import { useI18n } from '../i18n/I18nProvider';
import { CopyIcon, IconButton, LockIcon, TrashIcon } from '../ui';

type Pair = { id: number; k: string; v: string };

// Row identity must survive removing a middle row: keying rows by array index would make React
// reuse the inputs by position, misplacing focus (and uncommitted edits) after a delete.
let nextRowId = 0;
function newPair(k = '', v = ''): Pair {
  return { id: nextRowId++, k, v };
}

/** Shallow record equality (same keys + values), used to tell our own echo from an external change. */
function recordsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  return ak.length === Object.keys(b).length && ak.every((k) => a[k] === b[k]);
}

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
  preview,
  plain = false,
  keyLabel,
  valueLabel,
  secretKeys,
  onToggleSecret,
}: {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  /** Copy the entries as `key: value` lines. */
  onCopy?: (text: string) => void;
  /** Hover preview of a value's `${ … }` formula (see SeeboField). */
  preview?: (slot: string) => Promise<string | null>;
  /**
   * Values are literal text, not Seebo sources — use a plain input instead of the formula editor.
   * Set for enforced headers and environment variables, which are never rendered.
   */
  plain?: boolean;
  /** Column headers (default "Key" / "Value"). */
  keyLabel?: string;
  valueLabel?: string;
  /**
   * Keys currently labeled "secret" (advisory: config vs secret, environment variables only). Passing
   * this (with `onToggleSecret`) adds a per-row toggle column; omit both for callers with no such
   * concept (request params/headers). Only shown in table mode — the batch textarea has no discrete
   * rows to attach a per-key label to.
   */
  secretKeys?: ReadonlySet<string>;
  /** Flip a key's secret label (row identified by its current, committed key — never the trailing
   *  empty row, which has none yet). */
  onToggleSecret?: (key: string) => void;
}) {
  const { t } = useI18n();
  const kLabel = keyLabel ?? t('api.key');
  const vLabel = valueLabel ?? t('api.value');
  const [batch, setBatch] = useState(false);
  // Raw text the bulk editor shows — kept separate from `pairs` so re-parsing never fights the cursor.
  const [batchText, setBatchText] = useState('');
  const [pairs, setPairs] = useState<Pair[]>(() => {
    const seed = Object.entries(value).map(([k, v]) => newPair(k, v));
    return [...seed, newPair()];
  });
  // The record we last emitted via onChange, so we can tell our own echo from an external change.
  const lastEmitted = useRef(value);

  // Re-seed the rows when `value` changes EXTERNALLY (e.g. the URL bar was edited → the Params tab must
  // reflect it). Skips the echo of our own onChange (comparing to `lastEmitted`) so typing a row never
  // resets the cursor or the trailing empty row.
  useEffect(() => {
    if (recordsEqual(value, lastEmitted.current)) return;
    lastEmitted.current = value;
    const seed = Object.entries(value).map(([k, v]) => newPair(k, v));
    setPairs([...seed, newPair()]);
    if (batch) setBatchText(toText(seed));
  }, [value, batch]);

  function toggleBatch() {
    if (!batch) setBatchText(toText(pairs)); // entering batch: seed from the current pairs
    setBatch((b) => !b);
  }

  function emit(rec: Record<string, string>) {
    lastEmitted.current = rec;
    onChange(rec);
  }

  function commit(next: Pair[]) {
    const trimmed = next.filter((p, i) => p.k !== '' || p.v !== '' || i === next.length - 1);
    if (
      trimmed.length === 0 ||
      trimmed[trimmed.length - 1]!.k !== '' ||
      trimmed[trimmed.length - 1]!.v !== ''
    ) {
      trimmed.push(newPair());
    }
    setPairs(trimmed);
    const rec: Record<string, string> = {};
    for (const p of trimmed) if (p.k.trim()) rec[p.k.trim()] = p.v;
    emit(rec);
  }

  function setAt(i: number, patch: Partial<Pair>) {
    commit(pairs.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function removeAt(i: number) {
    commit(pairs.filter((_, idx) => idx !== i));
  }

  function applyBatch(text: string) {
    const rec = fromText(text);
    setPairs([...Object.entries(rec).map(([k, v]) => newPair(k, v)), newPair()]);
    emit(rec);
  }

  return (
    <div className="kv">
      {batch ? (
        plain ? (
          <textarea
            className="ui-input kv__batch"
            aria-label={t('api.batchEdit')}
            placeholder="key: value"
            rows={6}
            spellCheck={false}
            value={batchText}
            onChange={(e) => {
              setBatchText(e.target.value);
              applyBatch(e.target.value);
            }}
          />
        ) : (
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
        )
      ) : (
        // The same IDE-table grid as the folder/environment key-value editors (shared styles).
        <div className="env-vars">
          <div className="env-vars__headrow" aria-hidden="true">
            <span className="env-vars__colhead env-vars__key">{kLabel}</span>
            <span className="env-vars__colhead env-vars__value">{vLabel}</span>
            {onToggleSecret && <span className="env-vars__secretcol" />}
            <span className="env-vars__delcol" />
          </div>
          {pairs.map((p, i) => {
            const isTrailing = i === pairs.length - 1;
            const isSecret = !isTrailing && !!secretKeys?.has(p.k.trim());
            return (
              <div className="env-vars__row" key={p.id}>
                <input
                  className="env-vars__input env-vars__key"
                  aria-label={kLabel}
                  placeholder={kLabel}
                  value={p.k}
                  spellCheck={false}
                  onChange={(e) => setAt(i, { k: e.target.value })}
                />
                {plain ? (
                  <input
                    className="env-vars__input env-vars__value"
                    aria-label={vLabel}
                    placeholder={vLabel}
                    value={p.v}
                    spellCheck={false}
                    type={isSecret ? 'password' : 'text'}
                    onChange={(e) => setAt(i, { v: e.target.value })}
                  />
                ) : (
                  // Values may carry Seebo formulas (`${ … }`) → a single-line editor that highlights them.
                  <div className="env-vars__value env-vars__seebo">
                    <SeeboField
                      ariaLabel={vLabel}
                      placeholder={vLabel}
                      value={p.v}
                      onChange={(v) => setAt(i, { v })}
                      preview={preview}
                    />
                  </div>
                )}
                {onToggleSecret &&
                  (!isTrailing ? (
                    <IconButton
                      label={isSecret ? t('env.settings.markConfig') : t('env.settings.markSecret')}
                      aria-pressed={isSecret}
                      data-active={isSecret}
                      onClick={() => onToggleSecret(p.k.trim())}
                    >
                      <LockIcon />
                    </IconButton>
                  ) : (
                    <span className="env-vars__secretcol" />
                  ))}
                {!isTrailing ? (
                  <IconButton label={t('menu.delete')} onClick={() => removeAt(i)}>
                    <TrashIcon />
                  </IconButton>
                ) : (
                  <span className="env-vars__delcol" />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Mode toggle + copy, under the table and aligned with its right edge. */}
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
    </div>
  );
}
