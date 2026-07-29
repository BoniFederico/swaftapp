import { useEffect, useState } from 'react';
import { fromArazzo, type ScenarioGraph } from '@swaft/shared';
import { parseSpec } from '../document/engines/parseSpec';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/catalogs';
import { Button, Dialog } from '../ui';

type Parsed = { graph: ScenarioGraph } | null;
type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/** Steps whose `x-swaft` `ref` points at a template id this workspace doesn't have — the fidelity
 *  report for a scenario import (mirrors the collection import/export report pattern). */
function unresolvedRefsReport(
  graph: ScenarioGraph,
  existingTemplateIds: Set<string>,
  t: Translate,
): string[] {
  const unresolved = graph.nodes.filter(
    (n) => n.kind === 'template' && n.ref != null && !existingTemplateIds.has(n.ref),
  );
  if (unresolved.length === 0) return [];
  return [
    t('import.arazzoUnresolved', {
      count: String(unresolved.length),
      refs: unresolved.map((n) => n.ref).join(', '),
    }),
  ];
}

/**
 * Replace a scenario's graph from a pasted/dropped Arazzo 1.0 workflow document. Parsing (JSON or
 * YAML) and the `fromArazzo` conversion happen here with the shared codec; only the materialization
 * (writing the new graph back as the template's source) is left to the caller. Steps whose `x-swaft`
 * template ref doesn't resolve in this workspace are surfaced as a fidelity report, not blocked —
 * they still import (as a node with a dangling `ref`) so the user can rewire them on the canvas.
 */
export function ImportArazzoDialog({
  open,
  busy,
  scenarioName,
  existingTemplateIds,
  onImport,
  onClose,
}: {
  open: boolean;
  busy?: boolean;
  scenarioName: string;
  existingTemplateIds: Set<string>;
  onImport: (graph: ScenarioGraph) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<Parsed>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setParsed(null);
      setError(null);
    }
  }, [open]);

  async function analyze(content: string): Promise<void> {
    setText(content);
    setError(null);
    setParsed(null);
    if (content.trim() === '') return;
    let doc: unknown;
    try {
      doc = await parseSpec(content);
    } catch {
      setError(t('import.parseError'));
      return;
    }
    const { graph } = fromArazzo(doc);
    if (graph.nodes.length === 0) {
      setError(t('import.arazzoEmpty'));
      return;
    }
    setParsed({ graph });
  }

  const report = parsed ? unresolvedRefsReport(parsed.graph, existingTemplateIds, t) : [];
  const canImport = !!parsed && parsed.graph.nodes.length > 0;

  return (
    <Dialog
      open={open}
      title={t('import.arazzoTitle', { name: scenarioName })}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('name.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !canImport}
            onClick={() => parsed && onImport(parsed.graph)}
          >
            {t('import.action')}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 'var(--space-4)' }}>
        <label
          className="ui-field import-dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void f.text().then(analyze);
          }}
        >
          <span className="ui-field__label">{t('import.orFile')}</span>
          <input
            type="file"
            accept=".yaml,.yml,.json,application/json,text/yaml"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void f.text().then(analyze);
            }}
          />
        </label>

        <label className="ui-field">
          <span className="ui-field__label">{t('import.paste')}</span>
          <textarea
            className="ui-input"
            style={{ minHeight: 160, fontFamily: 'var(--font-mono)', resize: 'vertical' }}
            value={text}
            spellCheck={false}
            placeholder={t('import.arazzoPastePlaceholder')}
            onChange={(e) => void analyze(e.target.value)}
          />
        </label>

        {error && <span className="field-hint field-hint--error">{error}</span>}

        {parsed && (
          <>
            <p className="field-hint">
              {t('import.arazzoPreview', {
                nodes: String(parsed.graph.nodes.length),
                edges: String(parsed.graph.edges.length),
              })}
            </p>
            {report.map((line) => (
              <p key={line} className="field-hint field-hint--error">
                {line}
              </p>
            ))}
          </>
        )}
      </div>
    </Dialog>
  );
}
