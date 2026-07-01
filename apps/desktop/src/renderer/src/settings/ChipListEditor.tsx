import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { IconButton, PlusIcon } from '../ui';

/** Reusable add/remove list of string values rendered as removable chips. */
export function ChipListEditor({
  label,
  placeholder,
  values,
  onAdd,
  onRemove,
}: {
  label: string;
  placeholder?: string;
  values: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');

  function add() {
    const value = draft.trim();
    if (value && !values.includes(value)) onAdd(value);
    setDraft('');
  }

  return (
    <div className="ui-field">
      <span className="ui-field__label">{label}</span>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <input
          className="ui-input"
          aria-label={label}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <IconButton label={t('wsset.add')} onClick={add}>
          <PlusIcon />
        </IconButton>
      </div>
      {values.length === 0 ? (
        <span className="muted">{t('wsset.empty')}</span>
      ) : (
        <ul className="chip-list">
          {values.map((v) => (
            <li key={v} className="chip">
              <span>{v}</span>
              <button
                type="button"
                className="chip__remove"
                aria-label={`${t('wsset.remove')} ${v}`}
                onClick={() => onRemove(v)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
