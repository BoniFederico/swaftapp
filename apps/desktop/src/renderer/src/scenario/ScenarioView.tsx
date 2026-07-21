import { useEffect, useState } from 'react';
import {
  EMPTY_SCENARIO_GRAPH,
  parseScenarioGraph,
  type ScenarioGraph,
} from '@swaft/shared';
import type { ApiClient } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import { subscribeTreeChanged } from '../workspace/treeBus';

/**
 * Scenario View — the visual workflow editor for `scenario` templates (see docs `scenarios.md`). The
 * scenario's graph is stored as JSON in the template `source`; this view parses it defensively (a
 * malformed, hand-edited source degrades to an error state instead of crashing) and — from the next
 * phase — lets the user build it on a canvas, persisting back via `template.updateSource`.
 *
 * Phase 0: load + defensive parse + title/reload plumbing, with a placeholder body. The canvas lands
 * in Phase 1.
 */
export function ScenarioView({
  client,
  templateId,
  onTitleChange,
}: {
  client: ApiClient;
  templateId: string;
  onDirtyChange?: (dirty: boolean) => void;
  onTitleChange?: (name: string) => void;
}) {
  const { t } = useI18n();
  const [graph, setGraph] = useState<ScenarioGraph>(EMPTY_SCENARIO_GRAPH);
  const [parseError, setParseError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load (and reload on external save, e.g. hand-editing the JSON in the Template Editor) the graph.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await client.call('template.get', { id: templateId });
        if (cancelled) return;
        onTitleChange?.(res.template.name);
        const { graph: parsed, ok } = parseScenarioGraph(res.template.source);
        setParseError(!ok);
        // Never overwrite the in-memory graph from an unparseable source (parity with the API view).
        if (ok) setGraph(parsed);
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    }
    void load();
    const unsubscribe = subscribeTreeChanged(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, templateId, onTitleChange]);

  return (
    <div className="scenario">
      <div className="scenario__canvas">
        {parseError ? (
          <div className="auth-error" role="alert">
            {t('scenario.parseError')}
          </div>
        ) : !loaded ? (
          <span className="muted">{t('doc.loading')}</span>
        ) : (
          <div className="scenario__placeholder muted">
            {t('scenario.placeholder', { nodes: graph.nodes.length, edges: graph.edges.length })}
          </div>
        )}
      </div>
    </div>
  );
}
