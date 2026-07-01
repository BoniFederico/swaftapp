import { useEffect, useState } from 'react';
import type { RenderResultDto, RequirementDto } from '@swaft/shared';
import { ApiClient, ApiError } from '../api-client/client';
import { InputPanel } from '../document/InputPanel';
import { OutputView } from '../document/OutputView';
import { compactValues, hasInvalidInputs } from '../document/inputValidation';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Card } from '../ui';

/**
 * Batch Document View — the main-area counterpart to DocumentView, but for a batch: it analyzes the
 * batched templates' **combined** inputs (as if they were one template), renders the composite via
 * Seebo ABSORB, and shows the output. Lives to the right of the Working Tree, in the usual input
 * container, so loading a batch feels just like opening a single template.
 */
export function BatchDocumentView({
  client,
  templateIds,
}: {
  client: ApiClient;
  templateIds: string[];
}) {
  const { t } = useI18n();
  const [requirements, setRequirements] = useState<RequirementDto[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<RenderResultDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    setRenderError(null);
    setValues({});
    void (async () => {
      try {
        const r = await client.call('batch.analyze', { templateIds });
        if (!cancelled) setRequirements(r.requirements);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.swaft.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, templateIds]);

  async function render() {
    setBusy(true);
    setRenderError(null);
    try {
      const res = await client.call('batch.render', { templateIds, values: compactValues(values) });
      setResult(res.result);
    } catch (e) {
      setRenderError(e instanceof ApiError ? e.swaft.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="doc">
      <div className="doc__panel">
        <Card title={t('batch.docTitle', { n: templateIds.length })}>
          {error ? (
            <div className="auth-error" role="alert">
              {error}
            </div>
          ) : requirements.length === 0 ? (
            <span className="muted">{t('doc.noInputs')}</span>
          ) : (
            <InputPanel
              requirements={requirements}
              values={values}
              onChange={(id, value) => setValues((v) => ({ ...v, [id]: value }))}
            />
          )}
          <div className="row" style={{ marginTop: 'var(--space-4)' }}>
            <Button
              onClick={() => void render()}
              disabled={busy || hasInvalidInputs(requirements, values)}
            >
              {busy ? t('doc.rendering') : t('batch.render')}
            </Button>
          </div>
        </Card>
      </div>

      <div className="doc__output">
        <OutputView
          result={result}
          error={renderError}
          busy={busy}
          fileBaseName="batch"
          subtype={null}
          testId="batch-output"
        />
      </div>
    </div>
  );
}
