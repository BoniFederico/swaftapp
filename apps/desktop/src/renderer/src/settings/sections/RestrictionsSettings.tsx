import { useEffect, useState } from 'react';
import type { WorkspaceSettingsDto, WorkspaceSettingsUpdate } from '@swaft/shared';
import { ApiClient, ApiError } from '../../api-client/client';
import { useI18n } from '../../i18n/I18nProvider';
import { Button, Select, TextField } from '../../ui';
import { ChipListEditor } from '../ChipListEditor';

/** RESTRICTIONS: execution mode (dev-gated), allowed types/subtypes/capabilities/actions/domains, proxy + export root. */
export function RestrictionsSettings({ client }: { client: ApiClient }) {
  const { t } = useI18n();
  const [s, setS] = useState<WorkspaceSettingsDto | null>(null);
  const [pendingDev, setPendingDev] = useState(false);
  const [proxy, setProxy] = useState('');
  const [exportRoot, setExportRoot] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const res = await client.call('settings.get');
        setS(res.settings);
        setProxy(res.settings.proxyUrl ?? '');
        setExportRoot(res.settings.fileExportRoot ?? '');
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

  if (!s) return null;

  const lists: { key: keyof WorkspaceSettingsDto & string; label: string; placeholder?: string }[] = [
    { key: 'allowedTypes', label: t('wsset.types') },
    { key: 'allowedSubtypes', label: t('wsset.subtypes') },
    { key: 'allowedCapabilities', label: t('wsset.capabilities') },
    { key: 'allowedActions', label: t('wsset.actions') },
    { key: 'allowedDomains', label: t('wsset.allowedDomains'), placeholder: t('wsset.domainPlaceholder') },
  ];

  return (
    <div className="col" style={{ gap: 'var(--space-5)', maxWidth: 560 }}>
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
            <Button variant="danger" onClick={() => void patch({ executionMode: 'dev', confirmDev: true }).then(() => setPendingDev(false))}>
              {t('wsset.devConfirm')}
            </Button>
          </div>
        )}
      </div>

      {lists.map((l) => {
        const values = s[l.key] as string[];
        return (
          <ChipListEditor
            key={l.key}
            label={l.label}
            placeholder={l.placeholder}
            values={values}
            onAdd={(v) => void patch({ [l.key]: [...values, v] } as WorkspaceSettingsUpdate)}
            onRemove={(v) =>
              void patch({ [l.key]: values.filter((x) => x !== v) } as WorkspaceSettingsUpdate)
            }
          />
        );
      })}

      <div className="col" style={{ gap: 'var(--space-3)' }}>
        <TextField label={t('wsset.proxy')} value={proxy} onChange={(e) => setProxy(e.target.value)} />
        <TextField
          label={t('wsset.exportRoot')}
          value={exportRoot}
          onChange={(e) => setExportRoot(e.target.value)}
        />
        <div className="row">
          <Button
            variant="secondary"
            onClick={() =>
              void patch({ proxyUrl: proxy.trim() || null, fileExportRoot: exportRoot.trim() || null })
            }
          >
            {t('wsset.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
