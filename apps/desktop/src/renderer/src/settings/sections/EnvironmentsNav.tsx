import { useEffect } from 'react';
import { useEnvironments } from '../../environment/EnvironmentProvider';
import { useI18n } from '../../i18n/I18nProvider';
import { PlusIcon } from '../../ui';

/**
 * The environments sub-navigation, nested under the "Environments" entry in the Settings nav: one row
 * per environment (active dot + name + variable count) followed by an "add new" row. Selecting a row
 * drives the detail pane on the right. Auto-selects the first environment so the detail is never blank
 * when there are environments to show.
 */
export function EnvironmentsNav({
  selectedId,
  creating,
  onSelect,
  onCreateNew,
}: {
  selectedId: string | null;
  creating: boolean;
  onSelect: (id: string) => void;
  onCreateNew: () => void;
}) {
  const { t } = useI18n();
  const { environments, activeId } = useEnvironments();

  useEffect(() => {
    if (!creating && !selectedId && environments[0]) onSelect(environments[0].id);
  }, [environments, selectedId, creating, onSelect]);

  return (
    <ul className="settings-subnav">
      {environments.map((env) => (
        <li key={env.id}>
          <button
            type="button"
            className={`settings-subnav__item${
              env.id === selectedId && !creating ? ' is-active' : ''
            }`}
            onClick={() => onSelect(env.id)}
          >
            <span
              className={`settings-subnav__dot${env.id === activeId ? '' : ' settings-subnav__dot--off'}`}
              title={env.id === activeId ? t('env.settings.activeHint') : undefined}
              aria-hidden={env.id === activeId ? undefined : true}
            />
            <span className="settings-subnav__name">{env.name}</span>
            <span className="env-settings__count">{env.varCount}</span>
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          className={`settings-subnav__item settings-subnav__add${creating ? ' is-active' : ''}`}
          onClick={onCreateNew}
        >
          <PlusIcon />
          <span className="settings-subnav__name">{t('env.settings.new')}</span>
        </button>
      </li>
    </ul>
  );
}
