import type { RequestAction } from '@swaft/shared';
import { useI18n } from '../i18n/I18nProvider';
import { Button, IconButton, Select, Switch, TrashIcon } from '../ui';
import { KeyValueEditor } from './KeyValueEditor';

/**
 * The request's Actions tab: which `action` templates run around the call, and with what input.
 *
 * Effects stay out of the formula fields (a request field declaring `action(...)` is still
 * rejected); they are listed here instead, so what a request *does* besides being sent is visible
 * in one place rather than hidden inside a header value.
 */
export function RequestActionsEditor({
  actions,
  available,
  onChange,
  preview,
}: {
  actions: RequestAction[];
  /** Names of the action templates in this workspace, for the picker. */
  available: string[];
  onChange: (actions: RequestAction[]) => void;
  preview?: (slot: string) => Promise<string | null>;
}) {
  const { t } = useI18n();

  const patch = (index: number, change: Partial<RequestAction>) =>
    onChange(actions.map((a, i) => (i === index ? { ...a, ...change } : a)));

  const add = () =>
    onChange([...actions, { ref: available[0] ?? '', trigger: 'pre', input: {}, enabled: true }]);

  if (available.length === 0 && actions.length === 0) {
    return <p className="muted">{t('api.actions.none')}</p>;
  }

  return (
    <div className="col" style={{ gap: 'var(--space-4)' }}>
      {actions.length === 0 && <p className="muted">{t('api.actions.empty')}</p>}

      {actions.map((action, i) => (
        <div className="req-action" key={i}>
          <div className="req-action__head">
            <Select
              aria-label={t('api.actions.action')}
              value={action.ref}
              onChange={(ref) => patch(i, { ref })}
              options={[
                // A reference to a since-renamed action must stay visible, not vanish silently.
                ...(action.ref && !available.includes(action.ref)
                  ? [{ value: action.ref, label: `${action.ref} — ${t('api.actions.missing')}` }]
                  : []),
                ...available.map((name) => ({ value: name, label: name })),
              ]}
            />
            <Select
              aria-label={t('api.actions.trigger')}
              value={action.trigger}
              onChange={(trigger) => patch(i, { trigger: trigger === 'post' ? 'post' : 'pre' })}
              options={[
                { value: 'pre', label: t('api.actions.pre') },
                { value: 'post', label: t('api.actions.post') },
              ]}
            />
            <span className="req-action__spacer" />
            <Switch
              label={t('api.actions.enabled')}
              checked={action.enabled !== false}
              onChange={(enabled) => patch(i, { enabled })}
            />
            <IconButton
              label={t('menu.delete')}
              onClick={() => onChange(actions.filter((_, j) => j !== i))}
            >
              <TrashIcon />
            </IconButton>
          </div>

          <span className="field-hint">
            {t(action.trigger === 'pre' ? 'api.actions.preHint' : 'api.actions.postHint')}
          </span>

          <KeyValueEditor
            value={action.input ?? {}}
            onChange={(input) => patch(i, { input })}
            preview={preview}
            keyLabel={t('api.actions.inputKey')}
            valueLabel={t('api.actions.inputValue')}
          />
        </div>
      ))}

      <div className="row">
        <Button variant="ghost" disabled={available.length === 0} onClick={add}>
          {t('api.actions.add')}
        </Button>
      </div>
    </div>
  );
}
