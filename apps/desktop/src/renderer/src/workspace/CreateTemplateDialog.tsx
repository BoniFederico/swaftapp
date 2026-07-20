import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { isCodeTemplateType, type TemplateType } from '@swaft/shared';
import { useI18n } from '../i18n/I18nProvider';
import { ApiIcon, BoltIcon, Button, CapabilityIcon, Dialog, DocumentIcon, TextField } from '../ui';

/** Capability/action names are referenced like a function, so they must be JS identifiers. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The four template types, with the same glyphs the rest of the app uses for them. */
const TYPE_OPTIONS = [
  { type: 'document', Icon: DocumentIcon, labelKey: 'tpl.document', descKey: 'tpl.documentDesc' },
  { type: 'api', Icon: ApiIcon, labelKey: 'tpl.api', descKey: 'tpl.apiDesc' },
  { type: 'capability', Icon: CapabilityIcon, labelKey: 'tpl.capability', descKey: 'tpl.capabilityDesc' },
  { type: 'action', Icon: BoltIcon, labelKey: 'tpl.action', descKey: 'tpl.actionDesc' },
] as const;

/** WAI-ARIA radio cards (icon + name + one-liner): click or arrow keys select, focus follows. */
function TypePicker({ value, onChange }: { value: TemplateType; onChange: (t: TemplateType) => void }) {
  const { t } = useI18n();
  const idBase = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (delta === 0) return;
    e.preventDefault();
    const current = TYPE_OPTIONS.findIndex((o) => o.type === value);
    const next = (current + delta + TYPE_OPTIONS.length) % TYPE_OPTIONS.length;
    onChange(TYPE_OPTIONS[next].type);
    refs.current[next]?.focus();
  }

  return (
    <div className="ui-field">
      <span className="ui-field__label" id={`${idBase}-label`}>
        {t('tpl.type')}
      </span>
      <div className="tpl-type-grid" role="radiogroup" aria-labelledby={`${idBase}-label`}>
        {TYPE_OPTIONS.map(({ type, Icon, labelKey, descKey }, i) => (
          <button
            key={type}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={type === value}
            aria-labelledby={`${idBase}-${type}`}
            aria-describedby={`${idBase}-${type}-desc`}
            tabIndex={type === value ? 0 : -1}
            className="tpl-type-card"
            onClick={() => onChange(type)}
            onKeyDown={onKeyDown}
          >
            <Icon className={`tpl-type-card__icon tpl-type-card__icon--${type}`} />
            <span className="tpl-type-card__label" id={`${idBase}-${type}`}>
              {t(labelKey)}
            </span>
            <span className="tpl-type-card__desc" id={`${idBase}-${type}-desc`}>
              {t(descKey)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Create-template dialog: name + type (document / API / capability / action). */
export function CreateTemplateDialog({
  open,
  busy,
  onSubmit,
  onClose,
}: {
  open: boolean;
  busy?: boolean;
  onSubmit: (name: string, type: TemplateType) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [type, setType] = useState<TemplateType>('document');

  useEffect(() => {
    if (open) {
      setName('');
      setType('document');
    }
  }, [open]);

  // Code kinds are called by their name, so it must be a valid identifier — checked live rather than
  // letting the create fail server-side (which used to look like nothing happening).
  const trimmed = name.trim();
  const needsIdentifier = isCodeTemplateType(type);
  const badName = needsIdentifier && trimmed.length > 0 && !IDENTIFIER.test(trimmed);
  const canSubmit = trimmed.length > 0 && !badName;

  function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (canSubmit) onSubmit(trimmed, type);
  }

  return (
    <Dialog
      open={open}
      title={t('tree.createTemplate')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('name.cancel')}
          </Button>
          <Button variant="primary" disabled={busy || !canSubmit} onClick={submit}>
            {t('name.create')}
          </Button>
        </>
      }
    >
      <form className="col" style={{ gap: 'var(--space-4)' }} onSubmit={submit}>
        <div className="col" style={{ gap: 'var(--space-1)' }}>
          <TextField label={t('name.label')} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          {needsIdentifier && (
            <span className={badName ? 'field-hint field-hint--error' : 'field-hint'}>
              {t('tpl.codeNameHint')}
            </span>
          )}
        </div>
        <TypePicker value={type} onChange={setType} />
      </form>
    </Dialog>
  );
}
