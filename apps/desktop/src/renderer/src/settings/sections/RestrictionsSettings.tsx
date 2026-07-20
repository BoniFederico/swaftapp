import { useEffect, useState } from 'react';
import type { ExecutionMode, WorkspaceSettingsDto, WorkspaceSettingsUpdate } from '@swaft/shared';
import { ApiClient, ApiError } from '../../api-client/client';
import { KeyValueEditor } from '../../document/KeyValueEditor';
import { useI18n } from '../../i18n/I18nProvider';
import { Button, Select, Switch, TextField, useToast } from '../../ui';
import { ChipListEditor } from '../ChipListEditor';

/** The whole editable state of this section, as a single draft object. */
interface Draft {
  executionMode: ExecutionMode;
  batcherEnabled: boolean;
  blockedDomains: string[];
  proxyUrl: string;
  enforcedHeaders: Record<string, string>;
}

function toDraft(s: WorkspaceSettingsDto): Draft {
  return {
    executionMode: s.executionMode,
    batcherEnabled: s.batcherEnabled,
    blockedDomains: s.blockedDomains,
    proxyUrl: s.proxyUrl ?? '',
    enforcedHeaders: s.enforcedHeaders,
  };
}

/**
 * RESTRICTIONS: execution mode (dev-gated) + the outgoing-HTTP policy — batcher switch, blocked
 * domains, enforced proxy and enforced headers (all applied by the HTTP client in the main process).
 *
 * Every control edits a local draft; nothing reaches the workspace until Save, which sends one
 * `settings.update` with the fields that actually changed.
 */
export function RestrictionsSettings({ client }: { client: ApiClient }) {
  const { t } = useI18n();
  const toast = useToast();
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [devConfirmed, setDevConfirmed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { settings } = await client.call('settings.get');
        setSaved(toDraft(settings));
        setDraft(toDraft(settings));
      } catch {
        /* best-effort */
      }
    })();
  }, [client]);

  function edit(patch: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  async function save() {
    if (!draft || !saved) return;
    const patch: WorkspaceSettingsUpdate = {};
    if (draft.executionMode !== saved.executionMode) {
      patch.executionMode = draft.executionMode;
      if (draft.executionMode === 'dev') patch.confirmDev = true;
    }
    if (draft.batcherEnabled !== saved.batcherEnabled) patch.batcherEnabled = draft.batcherEnabled;
    if (JSON.stringify(draft.blockedDomains) !== JSON.stringify(saved.blockedDomains))
      patch.blockedDomains = draft.blockedDomains;
    if (draft.proxyUrl.trim() !== saved.proxyUrl.trim()) patch.proxyUrl = draft.proxyUrl.trim() || null;
    if (JSON.stringify(draft.enforcedHeaders) !== JSON.stringify(saved.enforcedHeaders))
      patch.enforcedHeaders = draft.enforcedHeaders;

    try {
      const { settings } = await client.call('settings.update', patch);
      setSaved(toDraft(settings));
      setDraft(toDraft(settings));
      setDevConfirmed(false);
      toast.show(t('toast.saved'), 'success');
    } catch (err) {
      toast.show(err instanceof ApiError ? err.swaft.message : String(err), 'error');
    }
  }

  if (!draft || !saved) return null;

  // Switching *into* dev mode stays gated behind an explicit confirmation before Save is allowed.
  const needsDevConfirm =
    draft.executionMode === 'dev' && saved.executionMode !== 'dev' && !devConfirmed;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  return (
    <div className="settings-form">
      <div className="col" style={{ gap: 'var(--space-2)' }}>
        <Select
          label={t('wsset.executionMode')}
          value={draft.executionMode}
          onChange={(v) => {
            edit({ executionMode: v === 'dev' ? 'dev' : 'sandbox' });
            setDevConfirmed(false);
          }}
          options={[
            { value: 'sandbox', label: t('wsset.exec.sandbox') },
            { value: 'dev', label: t('wsset.exec.dev') },
          ]}
        />
        {draft.executionMode === 'dev' && saved.executionMode !== 'dev' && (
          <div className="col" style={{ gap: 'var(--space-2)' }}>
            <div className="auth-error" role="alert">
              {t('wsset.devWarning')}
            </div>
            {!devConfirmed && (
              <Button variant="danger" onClick={() => setDevConfirmed(true)}>
                {t('wsset.devConfirm')}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="ui-field">
        <span className="ui-field__label">{t('wsset.batcher')}</span>
        <Switch
          checked={draft.batcherEnabled}
          onChange={(checked) => edit({ batcherEnabled: checked })}
          label={draft.batcherEnabled ? t('wsset.batcherOn') : t('wsset.batcherOff')}
        />
        <span className="field-hint">{t('wsset.batcherHint')}</span>
      </div>

      <div className="ui-field">
        <ChipListEditor
          label={t('wsset.blockedDomains')}
          placeholder={t('wsset.domainPlaceholder')}
          values={draft.blockedDomains}
          onAdd={(v) => edit({ blockedDomains: [...draft.blockedDomains, v] })}
          onRemove={(v) => edit({ blockedDomains: draft.blockedDomains.filter((x) => x !== v) })}
        />
        <span className="field-hint">{t('wsset.blockedDomainsHint')}</span>
      </div>

      <TextField
        label={t('wsset.proxy')}
        value={draft.proxyUrl}
        onChange={(e) => edit({ proxyUrl: e.target.value })}
      />

      <div className="ui-field">
        <span className="ui-field__label">{t('wsset.enforcedHeaders')}</span>
        <KeyValueEditor
          plain
          value={draft.enforcedHeaders}
          onChange={(enforcedHeaders) => edit({ enforcedHeaders })}
        />
        <span className="field-hint">{t('wsset.enforcedHeadersHint')}</span>
      </div>

      <div className="settings-form__actions">
        <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(saved)}>
          {t('name.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={!dirty || needsDevConfirm}
          onClick={() => void save()}
        >
          {t('wsset.save')}
        </Button>
      </div>
    </div>
  );
}
