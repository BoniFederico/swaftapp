import { useCallback, useEffect, useState } from 'react';
import type { EnvironmentDto, EnvironmentOwnerKind } from '@swaft/shared';
import { ApiClient, ApiError } from '../../api-client/client';
import { useEnvironments } from '../../environment/EnvironmentProvider';
import { OWNER_KIND_LABEL } from '../../environment/ownerKind';
import { useI18n } from '../../i18n/I18nProvider';
import { Button, ConfirmDialog, IconButton, PlusIcon, Switch, TextField, TrashIcon, useToast } from '../../ui';

interface VarRow {
  key: string;
  value: string;
}

function toRows(vars: Record<string, string>): VarRow[] {
  return Object.entries(vars).map(([key, value]) => ({ key, value }));
}
function fromRows(rows: VarRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of rows) {
    const k = key.trim();
    if (k) out[k] = value;
  }
  return out;
}

/** ENVIRONMENTS: create / rename / describe / edit variables of the workspace's environments, and pick
 * which one is active. The active environment feeds the `env(...)` Seebo capability. */
export function EnvironmentsSettings({ client }: { client: ApiClient }) {
  const { t } = useI18n();
  const { environments, activeId, setActive, refresh } = useEnvironments();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Default the selection to the first environment (or none) once the list is known.
  useEffect(() => {
    setSelectedId((prev) => prev ?? environments[0]?.id ?? null);
  }, [environments]);

  return (
    <div className="env-settings">
      <div className="env-settings__list">
        <div className="env-settings__listhead">
          <span className="env-settings__listtitle">{t('env.settings.list')}</span>
          <IconButton
            label={t('env.settings.new')}
            onClick={() => {
              setCreating(true);
              setSelectedId(null);
            }}
          >
            <PlusIcon />
          </IconButton>
        </div>
        {environments.length === 0 ? (
          <p className="env-settings__emptylist">{t('env.settings.empty')}</p>
        ) : (
          <ul className="env-settings__items">
            {environments.map((env) => (
              <li key={env.id}>
                <button
                  type="button"
                  className={`env-settings__item${env.id === selectedId && !creating ? ' is-active' : ''}`}
                  onClick={() => {
                    setCreating(false);
                    setSelectedId(env.id);
                  }}
                >
                  <span className="env-settings__name">
                    {env.id === activeId && <span className="env-settings__dot" title={t('env.settings.activeHint')} />}
                    {env.name}
                  </span>
                  <span className="env-settings__meta">
                    <span className="env-settings__count">{env.varCount}</span>
                    <span className={`ui-badge env-badge env-badge--${env.ownerKind}`}>
                      {t(OWNER_KIND_LABEL[env.ownerKind])}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="env-settings__detail">
        {creating ? (
          <CreateEnvForm
            client={client}
            onCancel={() => setCreating(false)}
            onCreated={async (env) => {
              setCreating(false);
              await refresh();
              setSelectedId(env.id);
            }}
          />
        ) : selectedId ? (
          <EnvironmentEditor
            key={selectedId}
            client={client}
            environmentId={selectedId}
            isActive={selectedId === activeId}
            onToggleActive={(on) => void setActive(on ? selectedId : null)}
            onChanged={() => void refresh()}
            onDeleted={async () => {
              await refresh();
              setSelectedId(null);
            }}
          />
        ) : (
          <p className="muted">{t('env.settings.selectHint')}</p>
        )}
      </div>
    </div>
  );
}

/** Segmented Personal / Workspace scope choice (fixed at creation). */
function OwnerKindSeg({
  value,
  onChange,
}: {
  value: EnvironmentOwnerKind;
  onChange: (kind: EnvironmentOwnerKind) => void;
}) {
  const { t } = useI18n();
  const kinds: EnvironmentOwnerKind[] = ['user', 'workspace'];
  return (
    <div className="ui-field">
      <span className="ui-field__label">{t('env.settings.owner')}</span>
      <div className="seg" role="radiogroup" aria-label={t('env.settings.owner')}>
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={value === kind}
            className={`seg__btn${value === kind ? ' seg__btn--active' : ''}`}
            onClick={() => onChange(kind)}
          >
            {t(OWNER_KIND_LABEL[kind])}
          </button>
        ))}
      </div>
      <span className="field-hint">{t(value === 'user' ? 'env.settings.ownerUserHint' : 'env.settings.ownerWorkspaceHint')}</span>
    </div>
  );
}

/** The create form: name + ownership (Personal / Workspace). */
function CreateEnvForm({
  client,
  onCancel,
  onCreated,
}: {
  client: ApiClient;
  onCancel: () => void;
  onCreated: (env: EnvironmentDto) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState('');
  const [ownerKind, setOwnerKind] = useState<EnvironmentOwnerKind>('user');
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await client.call('env.create', { name: name.trim(), ownerKind });
      onCreated(res.environment);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.swaft.message : t('env.settings.saveFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col" style={{ gap: 'var(--space-4)' }}>
      <h3 className="env-settings__title">{t('env.settings.new')}</h3>
      <TextField label={t('env.settings.name')} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      <OwnerKindSeg value={ownerKind} onChange={setOwnerKind} />
      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void create()}>
          {t('env.settings.create')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('name.cancel')}
        </Button>
      </div>
    </div>
  );
}

/** The editor for one environment: name, description, active toggle, variables, delete. */
function EnvironmentEditor({
  client,
  environmentId,
  isActive,
  onToggleActive,
  onChanged,
  onDeleted,
}: {
  client: ApiClient;
  environmentId: string;
  isActive: boolean;
  onToggleActive: (on: boolean) => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [env, setEnv] = useState<EnvironmentDto | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<VarRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(
    async (id: string) => {
      const res = await client.call('env.get', { id });
      setEnv(res.environment);
      setName(res.environment.name);
      setDescription(res.environment.description ?? '');
      setRows(toRows(res.environment.vars));
      setDirty(false);
    },
    [client],
  );

  useEffect(() => {
    void load(environmentId).catch(() => setEnv(null));
  }, [environmentId, load]);

  function edit(fn: () => void) {
    fn();
    setDirty(true);
  }

  async function save() {
    try {
      await client.call('env.update', {
        id: environmentId,
        name: name.trim(),
        description: description.trim() || null,
        vars: fromRows(rows),
      });
      toast.show(t('env.settings.saved'), 'success');
      onChanged();
      await load(environmentId);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.swaft.message : t('env.settings.saveFailed'), 'error');
    }
  }

  async function remove() {
    try {
      await client.call('env.delete', { id: environmentId });
      toast.show(t('env.settings.deleted'), 'success');
      onDeleted();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.swaft.message : t('env.settings.saveFailed'), 'error');
    }
  }

  if (!env) return null;

  return (
    <div className="col env-settings__editor">
      <div className="env-settings__detailhead">
        <h3 className="env-settings__title">{env.name}</h3>
        <span className={`ui-badge env-badge env-badge--${env.ownerKind}`}>{t(OWNER_KIND_LABEL[env.ownerKind])}</span>
        <span className="env-settings__spacer" />
        <Switch label={t('env.settings.active')} checked={isActive} onChange={onToggleActive} />
      </div>

      <TextField
        label={t('env.settings.name')}
        value={name}
        onChange={(e) => edit(() => setName(e.target.value))}
      />
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`env-desc-${environmentId}`}>
          {t('env.settings.description')}
        </label>
        <textarea
          id={`env-desc-${environmentId}`}
          className="ui-input env-settings__desc"
          rows={2}
          value={description}
          onChange={(e) => edit(() => setDescription(e.target.value))}
        />
      </div>

      <div className="ui-field">
        <span className="ui-field__label">{t('env.settings.variables')}</span>
        <div className="env-vars">
          <div className="env-vars__grid">
            <div className="env-vars__headrow" aria-hidden="true">
              <span className="env-vars__colhead env-vars__key">{t('env.settings.varKey')}</span>
              <span className="env-vars__colhead env-vars__value">{t('env.settings.varValue')}</span>
              <span className="env-vars__delcol" />
            </div>
            {rows.length === 0 && <p className="env-vars__empty">{t('env.settings.noVars')}</p>}
            {rows.map((row, i) => (
              <div key={i} className="env-vars__row">
                <input
                  className="env-vars__input env-vars__key"
                  aria-label={t('env.settings.varKey')}
                  placeholder={t('env.settings.varKey')}
                  value={row.key}
                  spellCheck={false}
                  onChange={(e) => edit(() => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, key: e.target.value } : r))))}
                />
                <input
                  className="env-vars__input env-vars__value"
                  aria-label={t('env.settings.varValue')}
                  placeholder={t('env.settings.varValue')}
                  value={row.value}
                  spellCheck={false}
                  onChange={(e) => edit(() => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, value: e.target.value } : r))))}
                />
                <IconButton
                  label={t('env.settings.removeVar')}
                  onClick={() => edit(() => setRows((rs) => rs.filter((_, j) => j !== i)))}
                >
                  <TrashIcon />
                </IconButton>
              </div>
            ))}
          </div>
          <div className="env-vars__foot">
            <Button variant="ghost" onClick={() => edit(() => setRows((rs) => [...rs, { key: '', value: '' }]))}>
              {t('env.settings.addVar')}
            </Button>
          </div>
        </div>
      </div>

      <div className="env-settings__actions">
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          {t('env.settings.delete')}
        </Button>
        <Button variant="primary" disabled={!dirty || !name.trim()} onClick={() => void save()}>
          {t('env.settings.save')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t('env.settings.deleteTitle')}
        message={t('env.settings.confirmDelete', { name: env.name })}
        confirmLabel={t('env.settings.delete')}
        cancelLabel={t('name.cancel')}
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
