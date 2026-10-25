import { useEffect, useState } from 'react';
import type { SecretStorageLevel } from '@swaft/shared';
import type { ApiClient } from '../../api-client/client';
import { useI18n } from '../../i18n/I18nProvider';
import { Button, TextField, useToast } from '../../ui';

/**
 * SECRETS: manage the OS-keychain secrets referenced by `${ secret('NAME') }`. Values are stored via
 * the OS-backed cipher in the user-data dir — **never** in the workspace files / `.swaft` / git, and
 * never returned to the renderer — so this UI lists only the names and lets you set or delete a value,
 * never reveal one. This is the deliberate counterpart to Environments (non-secret **config** vars,
 * which live in the workspace and are versioned).
 */
export function SecretsSettings({ client }: { client: ApiClient }) {
  const { t } = useI18n();
  const toast = useToast();
  const [refs, setRefs] = useState<string[]>([]);
  const [storage, setStorage] = useState<SecretStorageLevel>('secure');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void client
      .call('secret.list')
      .then((r) => {
        setRefs(r.refs);
        setStorage(r.storage ?? 'secure');
      })
      .catch(() => setRefs([]));
  }, [client]);

  const trimmed = name.trim();
  const isUpdate = refs.includes(trimmed);
  const canSave = trimmed.length > 0 && value.length > 0 && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      const r = await client.call('secret.set', { ref: trimmed, value });
      setRefs(r.refs);
      setName('');
      setValue('');
      toast.show(t('secrets.saved'), 'success');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(ref: string) {
    try {
      const r = await client.call('secret.delete', { ref });
      setRefs(r.refs);
      toast.show(t('secrets.deleted'), 'success');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  return (
    <div className="settings-form">
      <p className="field-hint">{t('secrets.intro')}</p>
      {storage !== 'secure' && (
        <div className="auth-error" role="alert">
          {t(storage === 'weak' ? 'secrets.storageWeak' : 'secrets.storageUnavailable')}
        </div>
      )}

      <div className="col" style={{ gap: 'var(--space-3)' }}>
        <TextField
          label={t('secrets.name')}
          placeholder={t('secrets.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label={t('secrets.value')}
          type="password"
          autoComplete="off"
          placeholder={t('secrets.valuePlaceholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
            {isUpdate ? t('secrets.update') : t('secrets.add')}
          </Button>
        </div>
      </div>

      <h3 className="settings-form__subhead">{t('secrets.stored')}</h3>
      {refs.length === 0 ? (
        <span className="muted">{t('secrets.empty')}</span>
      ) : (
        <ul className="secrets-list">
          {refs.map((ref) => (
            <li key={ref} className="secrets-list__row">
              <div className="col" style={{ gap: 'var(--space-1)' }}>
                <code className="secrets-list__name">{ref}</code>
                <span className="field-hint">{`\${ secret('${ref}') }`}</span>
              </div>
              <Button variant="ghost" onClick={() => void remove(ref)}>
                {t('secrets.delete')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
