import { useEffect, useState } from 'react';
import type { WorkspaceSettingsDto, WorkspaceSettingsUpdate } from '@swaft/shared';
import { ApiClient, ApiError } from '../../api-client/client';
import { useI18n } from '../../i18n/I18nProvider';
import { Button, IconButton, Select, Switch, TextField, TrashIcon, useToast } from '../../ui';
import { ChipListEditor } from '../ChipListEditor';

interface HeaderRow {
  key: string;
  value: string;
}

function toRows(headers: Record<string, string>): HeaderRow[] {
  return Object.entries(headers).map(([key, value]) => ({ key, value }));
}
function fromRows(rows: HeaderRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of rows) {
    const k = key.trim();
    if (k) out[k] = value;
  }
  return out;
}

/** RESTRICTIONS: execution mode (dev-gated) + the outgoing-HTTP policy — blocked domains,
 * enforced proxy and enforced headers (all applied by the HTTP client in the main process). */
export function RestrictionsSettings({ client }: { client: ApiClient }) {
  const { t } = useI18n();
  const toast = useToast();
  const [s, setS] = useState<WorkspaceSettingsDto | null>(null);
  const [pendingDev, setPendingDev] = useState(false);
  const [proxy, setProxy] = useState('');
  const [rows, setRows] = useState<HeaderRow[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await client.call('settings.get');
        setS(res.settings);
        setProxy(res.settings.proxyUrl ?? '');
        setRows(toRows(res.settings.enforcedHeaders));
      } catch {
        /* best-effort */
      }
    })();
  }, [client]);

  async function patch(p: WorkspaceSettingsUpdate) {
    setS((await client.call('settings.update', p)).settings);
  }

  async function onExecChange(value: string) {
    if (value === 'dev') {
      try {
        await patch({ executionMode: 'dev' });
        setPendingDev(false);
      } catch (err) {
        if (err instanceof ApiError && err.swaft.code === 'DEV_CONFIRMATION_REQUIRED') {
          setPendingDev(true);
        }
      }
    } else {
      await patch({ executionMode: 'sandbox' });
      setPendingDev(false);
    }
  }

  function edit(fn: () => void) {
    fn();
    setDirty(true);
  }

  async function saveHttp() {
    try {
      await patch({ proxyUrl: proxy.trim() || null, enforcedHeaders: fromRows(rows) });
      setDirty(false);
      toast.show(t('toast.saved'), 'success');
    } catch (err) {
      toast.show(err instanceof ApiError ? err.swaft.message : String(err), 'error');
    }
  }

  if (!s) return null;

  return (
    <div className="settings-form">
      <div className="col" style={{ gap: 'var(--space-2)' }}>
        <Select
          label={t('wsset.executionMode')}
          value={s.executionMode}
          onChange={(v) => void onExecChange(v)}
          options={[
            { value: 'sandbox', label: t('wsset.exec.sandbox') },
            { value: 'dev', label: t('wsset.exec.dev') },
          ]}
        />
        {pendingDev && (
          <div className="col" style={{ gap: 'var(--space-2)' }}>
            <div className="auth-error" role="alert">
              {t('wsset.devWarning')}
            </div>
            <Button
              variant="danger"
              onClick={() =>
                void patch({ executionMode: 'dev', confirmDev: true }).then(() => setPendingDev(false))
              }
            >
              {t('wsset.devConfirm')}
            </Button>
          </div>
        )}
      </div>

      <div className="ui-field">
        <span className="ui-field__label">{t('wsset.batcher')}</span>
        <Switch
          checked={s.batcherEnabled}
          onChange={(checked) => void patch({ batcherEnabled: checked })}
          label={s.batcherEnabled ? t('wsset.batcherOn') : t('wsset.batcherOff')}
        />
        <span className="field-hint">{t('wsset.batcherHint')}</span>
      </div>

      <div className="ui-field">
        <ChipListEditor
          label={t('wsset.blockedDomains')}
          placeholder={t('wsset.domainPlaceholder')}
          values={s.blockedDomains}
          onAdd={(v) => void patch({ blockedDomains: [...s.blockedDomains, v] })}
          onRemove={(v) => void patch({ blockedDomains: s.blockedDomains.filter((x) => x !== v) })}
        />
        <span className="field-hint">{t('wsset.blockedDomainsHint')}</span>
      </div>

      <TextField
        label={t('wsset.proxy')}
        value={proxy}
        onChange={(e) => edit(() => setProxy(e.target.value))}
      />

      <div className="ui-field">
        <span className="ui-field__label">{t('wsset.enforcedHeaders')}</span>
        <div className="env-vars">
          <div className="env-vars__headrow" aria-hidden="true">
            <span className="env-vars__colhead env-vars__key">{t('env.settings.varKey')}</span>
            <span className="env-vars__colhead env-vars__value">{t('env.settings.varValue')}</span>
            <span className="env-vars__delcol" />
          </div>
          {rows.length === 0 && <p className="env-vars__empty">{t('wsset.empty')}</p>}
          {rows.map((row, i) => (
            <div key={i} className="env-vars__row">
              <input
                className="env-vars__input env-vars__key"
                aria-label={t('env.settings.varKey')}
                placeholder={t('env.settings.varKey')}
                value={row.key}
                spellCheck={false}
                onChange={(e) =>
                  edit(() => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, key: e.target.value } : r))))
                }
              />
              <input
                className="env-vars__input env-vars__value"
                aria-label={t('env.settings.varValue')}
                placeholder={t('env.settings.varValue')}
                value={row.value}
                spellCheck={false}
                onChange={(e) =>
                  edit(() => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, value: e.target.value } : r))))
                }
              />
              <IconButton
                label={t('wsset.remove')}
                onClick={() => edit(() => setRows((rs) => rs.filter((_, j) => j !== i)))}
              >
                <TrashIcon />
              </IconButton>
            </div>
          ))}
          <div className="env-vars__foot">
            <Button variant="ghost" onClick={() => edit(() => setRows((rs) => [...rs, { key: '', value: '' }]))}>
              {t('wsset.add')}
            </Button>
          </div>
        </div>
        <span className="field-hint">{t('wsset.enforcedHeadersHint')}</span>
      </div>

      <div className="settings-form__actions">
        <Button variant="primary" disabled={!dirty} onClick={() => void saveHttp()}>
          {t('wsset.save')}
        </Button>
      </div>
    </div>
  );
}
