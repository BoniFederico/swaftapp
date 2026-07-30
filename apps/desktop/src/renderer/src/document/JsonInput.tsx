import { useRef, useState } from 'react';
import { CodeEditor } from '../editor/CodeEditor';
import { useI18n } from '../i18n/I18nProvider';

/**
 * JSON input widget: a file dropzone (click to browse or drag-and-drop a `.json` file) plus a
 * CodeMirror field (JSON + Seebo formula highlighting) so a JSON value can also be pasted/edited
 * directly. Valid JSON is stored structured; any other text is kept verbatim so the Input Panel can
 * flag it as invalid.
 */
export function JsonInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const text =
    typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2);

  function apply(raw: string) {
    onChange(coerceJson(raw));
  }
  async function readFile(file: File) {
    setFileName(file.name);
    apply(await file.text());
  }

  return (
    <div className="ui-field">
      <span className="ui-field__label">{label}</span>
      <div
        className={`jsonfield${over ? ' jsonfield--over' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={t('input.jsonDrop')}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void readFile(file);
        }}
      >
        <span className="jsonfield__hint">{fileName ?? t('input.jsonDrop')}</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void readFile(file);
          e.target.value = '';
        }}
      />
      <div className="jsonfield__code">
        <CodeEditor
          value={text}
          language="json"
          ariaLabel={label}
          onChange={(next) => {
            setFileName(null);
            apply(next);
          }}
        />
      </div>
    </div>
  );
}

/** Parse valid JSON to a structured value; otherwise keep the raw text (→ surfaced as invalid). */
function coerceJson(raw: string): unknown {
  if (raw.trim() === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
