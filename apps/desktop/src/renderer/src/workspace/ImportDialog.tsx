import { useEffect, useState } from 'react';
import { fromOpenApi, fromPostman, type ImportedCollectionDto } from '@swaft/shared';
import { parseSpec } from '../document/engines/parseSpec';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Dialog, TextField } from '../ui';

type Parsed = { collection: ImportedCollectionDto; format: 'OpenAPI' | 'Postman' } | null;

/** Detect the format from the parsed object and run the matching shared codec. */
function adapt(obj: unknown): Parsed {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if ('openapi' in o || 'swagger' in o || 'paths' in o) {
    return { collection: fromOpenApi(o), format: 'OpenAPI' };
  }
  const info = o.info;
  const isPostman =
    'item' in o || (info != null && typeof info === 'object' && 'schema' in (info as object));
  if (isPostman) return { collection: fromPostman(o), format: 'Postman' };
  return null;
}

/** Count the distinct nested folders a collection would create. */
function folderCount(collection: ImportedCollectionDto): number {
  const seen = new Set<string>();
  for (const r of collection.requests) {
    const acc: string[] = [];
    for (const seg of r.folderPath) {
      acc.push(seg);
      seen.add(acc.join('/'));
    }
  }
  return seen.size;
}

/**
 * Import an OpenAPI description or a Postman collection into a new project. Parsing and format
 * detection happen here with the shared codecs; only the materialization is a backend op
 * (`collection.import`). The scope preview shows what will be created before confirming.
 */
export function ImportDialog({
  open,
  busy,
  onImport,
  onClose,
}: {
  open: boolean;
  busy?: boolean;
  onImport: (collection: ImportedCollectionDto, projectName: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<Parsed>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    if (open) {
      setText('');
      setParsed(null);
      setError(null);
      setName('');
    }
  }, [open]);

  async function analyze(content: string): Promise<void> {
    setText(content);
    setError(null);
    setParsed(null);
    if (content.trim() === '') return;
    let obj: unknown;
    try {
      obj = await parseSpec(content);
    } catch {
      setError(t('import.parseError'));
      return;
    }
    const p = adapt(obj);
    if (!p) {
      setError(t('import.unrecognized'));
      return;
    }
    setParsed(p);
    setName((prev) => prev || p.collection.name);
  }

  const canImport = !!parsed && parsed.collection.requests.length > 0 && name.trim() !== '';

  return (
    <Dialog
      open={open}
      title={t('import.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('name.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !canImport}
            onClick={() => parsed && onImport(parsed.collection, name.trim())}
          >
            {t('import.action')}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 'var(--space-4)' }}>
        <label
          className="ui-field import-dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void f.text().then(analyze);
          }}
        >
          <span className="ui-field__label">{t('import.orFile')}</span>
          <input
            type="file"
            accept=".json,.yaml,.yml,application/json,text/yaml"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void f.text().then(analyze);
            }}
          />
        </label>

        <label className="ui-field">
          <span className="ui-field__label">{t('import.paste')}</span>
          <textarea
            className="ui-input"
            style={{ minHeight: 160, fontFamily: 'var(--font-mono)', resize: 'vertical' }}
            value={text}
            spellCheck={false}
            placeholder={t('import.pastePlaceholder')}
            onChange={(e) => void analyze(e.target.value)}
          />
        </label>

        {error && <span className="field-hint field-hint--error">{error}</span>}

        {parsed && (
          <>
            <p className="field-hint">
              {parsed.collection.requests.length === 0
                ? t('import.empty')
                : t('import.preview', {
                    format: parsed.format,
                    requests: String(parsed.collection.requests.length),
                    folders: String(folderCount(parsed.collection)),
                    envs: String(parsed.collection.environments.length),
                  })}
            </p>
            <TextField
              label={t('import.projectName')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}
