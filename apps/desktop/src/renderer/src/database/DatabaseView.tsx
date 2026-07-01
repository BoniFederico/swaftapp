import { useEffect, useState } from 'react';
import type { DbEngine, DbHistoryItem, DbResultDto } from '@swaft/shared';
import { ApiClient, ApiError } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Card, EmptyState, Select, VirtualList } from '../ui';

/**
 * Database View (M9): read-only-by-default SQL client. The connection is read-only; dangerous
 * statements are blocked by the backend with a clear error. Results are virtualized; history is
 * metadata-only. SQLite is live (sql.js); PostgreSQL is a reserved adapter. See SWAFT_UI_SPEC §15.
 */
export function DatabaseView({ client }: { client: ApiClient }) {
  const { t } = useI18n();
  const [engine, setEngine] = useState<DbEngine>('sqlite');
  const [file, setFile] = useState<string | null>(null);
  const [sql, setSql] = useState('SELECT 1');
  const [result, setResult] = useState<DbResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<DbHistoryItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void client
      .call('db.history.list')
      .then((r) => setHistory(r.items))
      .catch(() => undefined);
  }, [client]);

  async function pickFile() {
    const r = await client.call('db.pickFile');
    if (r.path) setFile(r.path);
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await client.call('db.query', { engine, file: file ?? undefined, sql });
      setResult(r.result);
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiError ? e.swaft.message : String(e));
    } finally {
      setBusy(false);
      setHistory((await client.call('db.history.list')).items);
    }
  }

  async function exportAs(format: 'csv' | 'json') {
    if (!result) return;
    await client.call('db.export', { format, columns: result.columns, rows: result.rows });
  }

  async function clearHistory() {
    setHistory((await client.call('db.history.clear')).items);
  }

  return (
    <div className="col" style={{ gap: 'var(--space-5)' }}>
      <Card title={t('db.title')}>
        <div className="col" style={{ gap: 'var(--space-3)' }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Select
              label={t('db.engine')}
              value={engine}
              onChange={(v) => setEngine(v as DbEngine)}
              options={[
                { value: 'sqlite', label: 'SQLite' },
                { value: 'postgres', label: 'PostgreSQL' },
              ]}
            />
            {engine === 'sqlite' && (
              <>
                <Button variant="secondary" onClick={() => void pickFile()}>
                  {t('db.pickFile')}
                </Button>
                <span className="muted">{file ?? t('db.noFile')}</span>
              </>
            )}
            <span className="ui-badge">{t('db.readonly')}</span>
          </div>

          <div className="ui-field">
            <span className="ui-field__label">{t('db.sql')}</span>
            <textarea
              className="ui-input editor__source"
              aria-label={t('db.sql')}
              rows={4}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
            />
          </div>

          <div className="row">
            <Button onClick={() => void run()} disabled={busy}>
              {busy ? t('db.running') : t('db.run')}
            </Button>
            <Button variant="secondary" disabled={!result} onClick={() => void exportAs('csv')}>
              {t('db.exportCsv')}
            </Button>
            <Button variant="secondary" disabled={!result} onClick={() => void exportAs('json')}>
              {t('db.exportJson')}
            </Button>
          </div>
        </div>
      </Card>

      <Card title={t('db.results')}>
        {error ? (
          <div className="auth-error" role="alert">
            {error}
          </div>
        ) : !result ? (
          <EmptyState title={t('db.noResult')} />
        ) : (
          <div className="db-grid" data-testid="db-results">
            <div className="db-grid__head">
              {result.columns.map((c) => (
                <span key={c} className="db-grid__cell">
                  {c}
                </span>
              ))}
            </div>
            <VirtualList
              items={result.rows}
              itemHeight={32}
              height={Math.min(360, Math.max(64, result.rows.length * 32))}
              getKey={(_row, i) => String(i)}
              renderItem={(row) => (
                <div className="db-grid__row">
                  {row.map((cell, i) => (
                    <span key={i} className="db-grid__cell">
                      {cell === null ? 'NULL' : String(cell)}
                    </span>
                  ))}
                </div>
              )}
            />
            <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
              {t('db.rows', { n: String(result.rowCount) })}
            </div>
          </div>
        )}
      </Card>

      <Card title={t('db.history')}>
        {history.length === 0 ? (
          <span className="muted">{t('wsset.empty')}</span>
        ) : (
          <>
            <ul className="api-history">
              {history.map((h) => (
                <li key={h.id} className="api-history__item">
                  <span className="ui-badge">{h.status}</span>
                  <span className="api-history__url muted">{h.sql}</span>
                </li>
              ))}
            </ul>
            <div className="row" style={{ marginTop: 'var(--space-3)' }}>
              <Button variant="ghost" onClick={() => void clearHistory()}>
                {t('db.clear')}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
