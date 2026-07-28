import { useEffect, useId, useState } from 'react';
import type { ExportScopeDto } from '@swaft/shared';
import { ApiClient, ApiError } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Dialog, useToast } from '../ui';

type Format = 'postman' | 'http' | 'bruno';
type Conversion = 'verbatim' | 'variabilize';

/** A minimal accessible radio group. */
function RadioGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const name = useId();
  return (
    <div className="ui-field" role="radiogroup" aria-label={label}>
      <span className="ui-field__label">{label}</span>
      <div className="col" style={{ gap: 'var(--space-1)' }}>
        {options.map((o) => (
          <label key={o.value} className="row" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
            <input
              type="radio"
              name={name}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Export the api requests in a scope (a request / folder / project / workspace) to an open format.
 * Gathering + serialization happen in the `collection.export` op; this dialog picks the format and the
 * Seebo conversion, shows the scope preview, then saves via the native save dialogs.
 */
export function ExportDialog({
  open,
  scope,
  defaultName,
  preview,
  client,
  onClose,
}: {
  open: boolean;
  scope: ExportScopeDto;
  defaultName: string;
  preview: { requests: number; skipped: number } | null;
  client: ApiClient;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [format, setFormat] = useState<Format>('postman');
  const [conversion, setConversion] = useState<Conversion>('variabilize');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setFormat('postman');
      setConversion('variabilize');
    }
  }, [open]);

  async function doExport() {
    setBusy(true);
    try {
      const res = await client.call('collection.export', { scope, format, conversion });
      if (res.files.length === 0) {
        toast.show(t('export.empty'), 'error');
        return;
      }
      if (res.files.length === 1) {
        const name = res.files[0].path.split('/').pop() ?? 'export.txt';
        const saved = await client.call('file.saveText', {
          suggestedName: name,
          content: res.files[0].content,
        });
        if (!saved.path) return; // cancelled
        toast.show(t('export.done'), 'success');
      } else {
        const saved = await client.call('file.saveFiles', {
          suggestedDirName: defaultName,
          files: res.files,
        });
        if (!saved.dir) return; // cancelled
        toast.show(t('export.doneMany', { count: String(saved.count) }), 'success');
      }
      if (res.report.length > 0) toast.show(res.report.join(' '), 'info');
      onClose();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.swaft.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={t('export.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('name.cancel')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void doExport()}>
            {t('export.action')}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 'var(--space-4)' }}>
        {preview && (
          <p className="field-hint">
            {t('export.preview', {
              requests: String(preview.requests),
              skipped: String(preview.skipped),
            })}
          </p>
        )}
        <RadioGroup<Format>
          label={t('export.format')}
          value={format}
          onChange={setFormat}
          options={[
            { value: 'postman', label: t('export.postman') },
            { value: 'http', label: t('export.http') },
            { value: 'bruno', label: t('export.bruno') },
          ]}
        />
        <RadioGroup<Conversion>
          label={t('export.conversion')}
          value={conversion}
          onChange={setConversion}
          options={[
            { value: 'variabilize', label: t('export.variabilize') },
            { value: 'verbatim', label: t('export.verbatim') },
          ]}
        />
        <p className="field-hint">{t('export.hint')}</p>
      </div>
    </Dialog>
  );
}
