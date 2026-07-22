import type { RequirementDto } from '@swaft/shared';
import { useI18n } from '../i18n/I18nProvider';
import { Select, Switch, TextField } from '../ui';
import { JsonInput } from './JsonInput';
import { validateInput } from './inputValidation';

/**
 * The Input Panel: one widget per requirement, chosen by the requirement's `capability` (the Seebo
 * input-widget catalog). The widget also reflects the underlying **type** and its limits — integers
 * reject decimals, durations enforce HH:mm:ss, JSON must parse — surfacing inline errors. The engine
 * never validates values, so this is the only guard.
 */
export function InputPanel({
  requirements,
  values,
  onChange,
}: {
  requirements: RequirementDto[];
  values: Record<string, unknown>;
  onChange: (id: string, value: unknown) => void;
}) {
  return (
    <div className="col" style={{ gap: 'var(--space-4)' }}>
      {requirements.map((req) => (
        <Widget key={req.id} req={req} value={values[req.id]} onChange={(v) => onChange(req.id, v)} />
      ))}
    </div>
  );
}

function Widget({
  req,
  value,
  onChange,
}: {
  req: RequirementDto;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { t } = useI18n();
  const label = req.label ?? req.id;
  const options = req.options ?? [];
  const kind = req.type?.kind ?? null;
  const err = validateInput(req, value);
  const errorText = err ? t(err.key, err.params) : undefined;

  const field = (() => {
    switch (req.capability) {
      case 'boolean':
        return <Switch label={label} checked={value === true} onChange={onChange} />;

      case 'number': {
        // Plain text input (not type=number) so we fully control what's accepted: integers reject
        // decimals/commas; valid numbers are stored as numbers, invalid input is kept for the error.
        const intKind = kind !== 'float';
        return (
          <TextField
            label={label}
            inputMode={intKind ? 'numeric' : 'decimal'}
            value={value == null ? '' : String(value)}
            onChange={(e) => onChange(coerceNumber(kind, e.target.value))}
          />
        );
      }

      case 'durationbox':
        return (
          <TextField
            label={label}
            placeholder={req.type?.pattern ?? 'HH:mm:ss'}
            value={typeof value === 'string' ? value : value == null ? '' : String(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case 'jsonInput':
        return <JsonInput label={label} value={value} onChange={onChange} />;

      case 'textarea':
        return (
          <div className="ui-field">
            <span className="ui-field__label">{label}</span>
            <textarea
              className="ui-input"
              rows={3}
              aria-label={label}
              value={typeof value === 'string' ? value : value == null ? '' : String(value)}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        );

      case 'listbox':
        return (
          <Select
            label={label}
            value={typeof value === 'string' ? value : ''}
            options={options.map((o) => ({ value: o, label: o }))}
            onChange={onChange}
          />
        );

      case 'multiOption': {
        const selected = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div className="ui-field">
            <span className="ui-field__label">{label}</span>
            <div className="col" style={{ gap: 'var(--space-1)' }}>
              {options.map((o) => (
                <Switch
                  key={o}
                  label={o}
                  checked={selected.includes(o)}
                  onChange={(on) => onChange(on ? [...selected, o] : selected.filter((x) => x !== o))}
                />
              ))}
            </div>
          </div>
        );
      }

      case 'datetimebox':
        return (
          <TextField
            label={label}
            type="datetime-local"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      // textbox and any unknown capability → a plain text field.
      default:
        return (
          <TextField
            label={label}
            value={typeof value === 'string' ? value : value == null ? '' : String(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        );
    }
  })();

  return (
    <div>
      {field}
      {errorText && (
        <span className="field-error" role="alert">
          {errorText}
        </span>
      )}
    </div>
  );
}

/** Store a valid number as a number (so the engine can format it); keep raw text when invalid. */
function coerceNumber(kind: string | null, raw: string): unknown {
  const t = raw.trim();
  if (t === '') return null;
  const ok = kind === 'float' ? /^-?\d+(\.\d+)?$/.test(t) : /^-?\d+$/.test(t);
  return ok ? Number(t) : raw;
}
