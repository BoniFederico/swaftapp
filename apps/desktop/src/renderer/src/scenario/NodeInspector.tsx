import type { ScenarioNode } from '@swaft/shared';
import { SeeboField } from '../editor/SeeboField';
import { useI18n } from '../i18n/I18nProvider';
import { Button, TextField } from '../ui';

/**
 * The right-hand inspector for the selected scenario node: kind-specific fields (a block's alias, a
 * decision's boolean formula, a delay's duration, a start's alias) plus delete. Edits are emitted as
 * immutable patches; `field` names the edited field so the parent can coalesce consecutive edits to
 * the same field into a single undo step.
 */
export function NodeInspector({
  node,
  templateName,
  onChange,
  onDelete,
}: {
  node: ScenarioNode;
  templateName: string | null;
  onChange: (patch: Partial<ScenarioNode>, field?: string) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <aside className="scenario-inspector" aria-label={t('scenario.inspector')}>
      <div className="scenario-inspector__head">
        <span className="scenario-inspector__kind">{t(`scenario.kind.${node.kind}`)}</span>
      </div>

      <div className="scenario-inspector__body">
        {node.kind === 'template' && (
          <>
            <div className="ui-field">
              <span className="ui-field__label">{t('scenario.block')}</span>
              <span className="scenario-inspector__ref">{templateName ?? t('scenario.missingRef')}</span>
            </div>
            <TextField
              label={t('scenario.alias')}
              value={node.alias ?? ''}
              onChange={(e) => onChange({ alias: e.target.value }, 'alias')}
            />
            <span className="field-hint">{t('scenario.aliasHint')}</span>
          </>
        )}

        {node.kind === 'start' && (
          <>
            <TextField
              label={t('scenario.alias')}
              value={node.alias ?? ''}
              onChange={(e) => onChange({ alias: e.target.value }, 'alias')}
            />
            <span className="field-hint">{t('scenario.startHint')}</span>
          </>
        )}

        {node.kind === 'decision' && (
          <>
            <TextField
              label={t('scenario.label')}
              value={node.label ?? ''}
              onChange={(e) => onChange({ label: e.target.value }, 'label')}
            />
            <div className="ui-field">
              <span className="ui-field__label">{t('scenario.condition')}</span>
              <SeeboField
                ariaLabel={t('scenario.condition')}
                placeholder="${ previous('login').status == 200 }"
                value={node.condition ?? ''}
                onChange={(v) => onChange({ condition: v }, 'condition')}
              />
            </div>
            <span className="field-hint">{t('scenario.conditionHint')}</span>
          </>
        )}

        {node.kind === 'delay' && (
          <div className="ui-field">
            <label className="ui-field__label" htmlFor="scenario-delay">
              {t('scenario.delaySeconds')}
            </label>
            <input
              id="scenario-delay"
              className="ui-input"
              type="number"
              min={0}
              step={0.5}
              value={(node.ms ?? 0) / 1000}
              onChange={(e) => {
                const secs = Number(e.target.value);
                onChange({ ms: Number.isFinite(secs) ? Math.max(0, Math.round(secs * 1000)) : 0 }, 'ms');
              }}
            />
          </div>
        )}
      </div>

      <div className="scenario-inspector__foot">
        <Button variant="danger" onClick={onDelete}>
          {t('scenario.deleteNode')}
        </Button>
      </div>
    </aside>
  );
}
