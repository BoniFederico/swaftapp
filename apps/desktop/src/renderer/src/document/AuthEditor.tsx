import type { AuthPlacement, HttpAuth } from '@swaft/shared';
import { SeeboField } from '../editor/SeeboField';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Select } from '../ui';

/** The field a resolved `secret('NAME')` would land in for each auth kind (`HttpService.applyAuth`'s
 *  own priority: the plain field wins over `secretRef`, so only these three kinds ever consult it). */
const LEGACY_SECRET_TARGET: Partial<Record<HttpAuth['kind'], 'token' | 'password' | 'value'>> = {
  bearer: 'token',
  basic: 'password',
  apikey: 'value',
};

/**
 * Authentication editor shared by the API view (request auth, with `inherit` from the folder chain)
 * and the Folder view (folder auth, with `inherit` from the parent chain). Plain labeled fields in
 * the same visual language as the request grids; string values accept Seebo `${ … }` formulas.
 */
export function AuthEditor({
  auth,
  onChange,
  inherited,
  preview,
}: {
  auth: HttpAuth;
  onChange: (auth: HttpAuth) => void;
  /** The concrete auth `inherit` would resolve to (null = nothing up the chain), for the preview. */
  inherited: HttpAuth | null;
  /** Hover preview of a field's `${ … }` formula (see SeeboField). */
  preview?: (slot: string) => Promise<string | null>;
}) {
  const { t } = useI18n();
  const set = (patch: Partial<HttpAuth>) => onChange({ ...auth, ...patch });

  // §3.4 item 3: a one-click migration off the legacy `auth.secretRef` keychain path (still resolved
  // as a fallback by HttpService, but never shown/editable here) onto a `${ secret('NAME') }` formula
  // in the field that actually wins at request time.
  const legacyTargetKey = LEGACY_SECRET_TARGET[auth.kind];
  const legacyCanMigrate = !!legacyTargetKey && !auth[legacyTargetKey];
  function migrateLegacySecretRef() {
    const { secretRef, ...rest } = auth;
    if (!secretRef) return;
    onChange(
      legacyTargetKey && !rest[legacyTargetKey]
        ? { ...rest, [legacyTargetKey]: `\${ secret('${secretRef}') }` }
        : rest,
    );
  }

  const kindLabel = (kind: HttpAuth['kind']): string =>
    kind === 'none'
      ? t('auth.none')
      : kind === 'inherit'
        ? t('auth.inherit')
        : kind === 'apikey'
          ? t('auth.apikey')
          : kind === 'basic'
            ? 'Basic'
            : 'Bearer';

  /** Field/value rows summarizing an auth (the inherit preview). */
  const previewRows = (a: HttpAuth): [string, string][] => {
    if (a.kind === 'basic') {
      return [
        [t('auth.username'), a.username ?? ''],
        [t('auth.password'), a.password ?? ''],
      ];
    }
    if (a.kind === 'bearer') return [[t('auth.token'), a.token ?? '']];
    if (a.kind === 'apikey') {
      return [
        [t('api.key'), a.key ?? a.headerName ?? ''],
        [t('api.value'), a.value ?? ''],
        [
          t('auth.placement'),
          a.placement === 'query' ? t('auth.placementQuery') : t('auth.placementHeader'),
        ],
      ];
    }
    return [];
  };

  return (
    <div className="auth-editor">
      <Select
        label={t('api.auth')}
        value={auth.kind}
        onChange={(v) => set({ kind: v as HttpAuth['kind'] })}
        options={[
          { value: 'none', label: t('auth.none') },
          { value: 'inherit', label: t('auth.inherit') },
          { value: 'basic', label: 'Basic' },
          { value: 'bearer', label: 'Bearer' },
          { value: 'apikey', label: t('auth.apikey') },
        ]}
      />

      {auth.secretRef && (
        <div className="auth-editor__legacy-secret" role="note">
          <p className="field-hint">
            {t(
              legacyCanMigrate ? 'auth.legacySecretRef.migrateHint' : 'auth.legacySecretRef.unusedHint',
              { ref: auth.secretRef },
            )}
          </p>
          <Button variant="ghost" onClick={migrateLegacySecretRef}>
            {t(legacyCanMigrate ? 'auth.legacySecretRef.migrate' : 'auth.legacySecretRef.remove')}
          </Button>
        </div>
      )}

      {auth.kind === 'inherit' && (
        <div className="auth-editor__preview">
          <span className="ui-field__label">{t('auth.inheritPreview')}</span>
          {inherited ? (
            <ul className="kv-readonly">
              <li className="kv-readonly__row">
                <span className="kv-readonly__key">{t('api.auth')}</span>
                <span className="muted">{kindLabel(inherited.kind)}</span>
              </li>
              {previewRows(inherited).map(([k, v]) => (
                <li key={k} className="kv-readonly__row">
                  <span className="kv-readonly__key">{k}</span>
                  <span className="muted">{v}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="field-hint">{t('auth.inheritNone')}</span>
          )}
        </div>
      )}

      {auth.kind === 'basic' && (
        <>
          <div className="ui-field">
            <span className="ui-field__label">{t('auth.username')}</span>
            <SeeboField
              ariaLabel={t('auth.username')}
              value={auth.username ?? ''}
              onChange={(username) => set({ username })}
              preview={preview}
            />
          </div>
          <div className="ui-field">
            <span className="ui-field__label">{t('auth.password')}</span>
            <SeeboField
              ariaLabel={t('auth.password')}
              value={auth.password ?? ''}
              onChange={(password) => set({ password })}
              preview={preview}
            />
          </div>
        </>
      )}

      {auth.kind === 'bearer' && (
        <div className="ui-field">
          <span className="ui-field__label">{t('auth.token')}</span>
          <SeeboField
            ariaLabel={t('auth.token')}
            value={auth.token ?? ''}
            onChange={(token) => set({ token })}
            preview={preview}
          />
        </div>
      )}

      {auth.kind === 'apikey' && (
        <>
          <div className="auth-editor__pair">
            <div className="ui-field">
              <span className="ui-field__label">{t('api.key')}</span>
              <SeeboField
                ariaLabel={t('api.key')}
                value={auth.key ?? auth.headerName ?? ''}
                onChange={(key) => set({ key })}
              />
            </div>
            <div className="ui-field">
              <span className="ui-field__label">{t('api.value')}</span>
              <SeeboField
                ariaLabel={t('api.value')}
                value={auth.value ?? ''}
                onChange={(value) => set({ value })}
                preview={preview}
              />
            </div>
          </div>
          <Select
            label={t('auth.placement')}
            value={auth.placement ?? 'header'}
            onChange={(v) => set({ placement: v as AuthPlacement })}
            options={[
              { value: 'header', label: t('auth.placementHeader') },
              { value: 'query', label: t('auth.placementQuery') },
            ]}
          />
        </>
      )}
    </div>
  );
}
