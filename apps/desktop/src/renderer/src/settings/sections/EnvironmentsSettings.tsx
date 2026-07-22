import { useCallback, useEffect, useState } from 'react';
import type { EnvironmentDto, EnvironmentOwnerKind } from '@swaft/shared';
import { ApiClient, ApiError } from '../../api-client/client';
import { useEnvironments } from '../../environment/EnvironmentProvider';
import { OWNER_KIND_LABEL } from '../../environment/ownerKind';
import { useI18n } from '../../i18n/I18nProvider';
import { KeyValueEditor } from '../../document/KeyValueEditor';
import { Button, ConfirmDialog, IconButton, Switch, TextField, TrashIcon, useToast } from '../../ui';

/**
 * ENVIRONMENTS detail pane. The environment list + "add new" live in the Settings nav
 * ({@link ../EnvironmentsNav}); this pane shows the create form or the selected environment's editor
 * (name / description / variables / active toggle / delete). The active environment feeds the
 * `env(...)` Seebo capability.
 */
export function EnvironmentsSettings({
  client,
  selectedId,
  creating,
  onSelect,
  onCancelCreate,
  onDeleted,
}: {
  client: ApiClient;
  /** The environment whose editor to show (ignored while `creating`). */
  selectedId: string | null;
  /** Whether the create form is shown instead of an editor. */
  creating: boolean;
  /** Select an environment (also used to focus a freshly-created one). */
  onSelect: (id: string) => void;
  /** Leave the create form without creating. */
  onCancelCreate: () => void;
  /** A deletion happened; clear the selection so the nav can re-default. */
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const { activeId, setActive, refresh } = useEnvironments();

  return (
    <div className="env-detail">
      {creating ? (
        <CreateEnvForm
          client={client}
          onCancel={onCancelCreate}
          onCreated={async (env) => {
            await refresh();
            onSelect(env.id);
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
            onDeleted();
          }}
        />
      ) : (
        <p className="muted">{t('env.settings.selectHint')}</p>
      )}
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
  const [vars, setVars] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(
    async (id: string) => {
      const res = await client.call('env.get', { id });
      setEnv(res.environment);
      setName(res.environment.name);
      setDescription(res.environment.description ?? '');
      setVars(res.environment.vars);
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

  function cancel() {
    if (!env) return;
    setName(env.name);
    setDescription(env.description ?? '');
    setVars(env.vars);
    setDirty(false);
  }

  async function save() {
    try {
      await client.call('env.update', {
        id: environmentId,
        name: name.trim(),
        description: description.trim() || null,
        vars,
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
        <IconButton label={t('env.settings.delete')} onClick={() => setConfirmDelete(true)}>
          <TrashIcon />
        </IconButton>
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
        <KeyValueEditor
          plain
          value={vars}
          onChange={(next) => edit(() => setVars(next))}
          keyLabel={t('env.settings.varKey')}
          valueLabel={t('env.settings.varValue')}
        />
      </div>

      <div className="settings-form__actions">
        <Button variant="ghost" disabled={!dirty} onClick={cancel}>
          {t('name.cancel')}
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
