import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EMPTY_SCENARIO_GRAPH,
  parseScenarioGraph,
  serializeScenarioGraph,
  type ScenarioGraph,
  type ScenarioNode,
  type TemplateType,
} from '@swaft/shared';
import { ApiClient, ApiError } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import { Button, useToast } from '../ui';
import { notifyTreeChanged, subscribeTreeChanged } from '../workspace/treeBus';
import { newId } from './graph-model';
import { NodeInspector } from './NodeInspector';
import { ScenarioCanvas, type ResolvedTemplate } from './ScenarioCanvas';

/** How long after the last edit the graph is auto-saved into the template source. */
const SAVE_DEBOUNCE_MS = 600;

/**
 * Scenario View — the visual workflow editor for `scenario` templates (see docs `scenarios.md`). The
 * graph rides in the template `source` as JSON; this view parses it defensively, edits it on a
 * pan/zoom canvas (drag templates in from the Working Tree, add decision/delay nodes, wire them), and
 * auto-saves back via `template.updateSource`. A malformed hand-edited source degrades to a read-only
 * error state instead of clobbering the file.
 */
export function ScenarioView({
  client,
  templateId,
  onDirtyChange,
  onTitleChange,
}: {
  client: ApiClient;
  templateId: string;
  onDirtyChange?: (dirty: boolean) => void;
  onTitleChange?: (name: string) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [graph, setGraph] = useState<ScenarioGraph>(EMPTY_SCENARIO_GRAPH);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [parseError, setParseError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  /** Templates that can be dropped/referenced as blocks: id → { name, type }. */
  const [templates, setTemplates] = useState<Map<string, ResolvedTemplate>>(new Map());

  // The last source we persisted, so the tree-change reload can skip the echo of our own save.
  const savedSourceRef = useRef<string | null>(null);
  const [savedSource, setSavedSource] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest serialized graph not yet written (debounced), so an unmount can flush it — the tab is
  // a preview tab that unmounts when the user switches away, and a pending edit must not be lost.
  const pendingSourceRef = useRef<string | null>(null);

  // Load (and reload on external save) the graph. Never overwrite from an unparseable source.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await client.call('template.get', { id: templateId });
        if (cancelled) return;
        onTitleChange?.(res.template.name);
        if (res.template.source === savedSourceRef.current) return; // our own save echoed back
        const { graph: parsed, ok } = parseScenarioGraph(res.template.source);
        setParseError(!ok);
        if (ok) {
          setGraph(parsed);
          const normalized = serializeScenarioGraph(parsed);
          savedSourceRef.current = normalized;
          setSavedSource(normalized);
        }
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

  // The templates a scenario can reference: api / action / capability (executable kinds).
  useEffect(() => {
    const refresh = () =>
      void client
        .call('tree.get')
        .then((res) => {
          const map = new Map<string, ResolvedTemplate>();
          for (const tpl of res.tree.templates) {
            if (tpl.type === 'api' || tpl.type === 'action' || tpl.type === 'capability') {
              map.set(tpl.id, { name: tpl.name, type: tpl.type as TemplateType });
            }
          }
          setTemplates(map);
        })
        .catch(() => setTemplates(new Map()));
    refresh();
    return subscribeTreeChanged(refresh);
  }, [client]);

  const resolveTemplate = useCallback((id: string) => templates.get(id) ?? null, [templates]);

  // Write the pending graph now (debounce elapsed, or flushed on unmount). `notify` is skipped on the
  // unmount path (no live subscribers to refresh). Returns the write promise (fire-and-forget on unmount).
  const flushSave = useCallback(
    (notify: boolean) => {
      const source = pendingSourceRef.current;
      if (source == null || source === savedSourceRef.current) return;
      pendingSourceRef.current = null;
      savedSourceRef.current = source; // optimistic: the reload must treat this as our own echo
      void client
        .call('template.updateSource', { id: templateId, source })
        .then(() => {
          if (notify) {
            setSavedSource(source);
            notifyTreeChanged();
          }
        })
        .catch((e) => {
          if (notify) toast.show(e instanceof ApiError ? e.swaft.message : String(e), 'error');
        });
    },
    [client, templateId, toast],
  );

  // Debounced auto-save: serialize the graph and persist it. Skipped while the source is unparseable
  // (read-only error state) so we never clobber a file the user is hand-fixing.
  const persist = useCallback(
    (next: ScenarioGraph) => {
      pendingSourceRef.current = serializeScenarioGraph(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => flushSave(true), SAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  const applyGraph = useCallback(
    (next: ScenarioGraph) => {
      setGraph(next);
      persist(next);
    },
    [persist],
  );

  // Flush a pending save on unmount so switching away from this (preview) tab never drops the last edit.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flushSave(false);
    },
    [flushSave],
  );

  const dirty = savedSource !== null && !parseError && serializeScenarioGraph(graph) !== savedSource;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const selected = useMemo(
    () => graph.nodes.find((n) => n.id === selectedId) ?? null,
    [graph.nodes, selectedId],
  );

  /** Add a non-template node (decision/delay/start) near the top-left, lightly cascaded. */
  function addControlNode(kind: ScenarioNode['kind']) {
    const n = graph.nodes.length;
    const node: ScenarioNode = {
      id: newId('n'),
      kind,
      position: { x: 160 + (n % 5) * 24, y: 240 + (n % 5) * 24 },
      ...(kind === 'delay' ? { ms: 1000 } : {}),
      ...(kind === 'decision' ? { condition: '' } : {}),
    };
    applyGraph({ ...graph, nodes: [...graph.nodes, node] });
    setSelectedId(node.id);
  }

  function deleteSelected() {
    if (!selectedId) return;
    applyGraph({
      nodes: graph.nodes.filter((nd) => nd.id !== selectedId),
      edges: graph.edges.filter((e) => e.from !== selectedId && e.to !== selectedId),
      version: 1,
    });
    setSelectedId(null);
  }

  // Delete/Backspace removes the selected node — unless the focus is in a text field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)) return;
      if (selectedId) {
        e.preventDefault();
        deleteSelected();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, graph]);

  if (parseError) {
    return (
      <div className="scenario">
        <div className="scenario__canvas scenario__canvas--error">
          <div className="auth-error" role="alert">
            {t('scenario.parseError')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scenario">
      <div className="scenario__toolbar">
        <Button variant="secondary" onClick={() => addControlNode('start')}>
          {t('scenario.addStart')}
        </Button>
        <Button variant="secondary" onClick={() => addControlNode('decision')}>
          {t('scenario.addDecision')}
        </Button>
        <Button variant="secondary" onClick={() => addControlNode('delay')}>
          {t('scenario.addDelay')}
        </Button>
        <span className="scenario__toolbar-hint muted">{t('scenario.dropHint')}</span>
      </div>

      <div className="scenario__main">
        <ScenarioCanvas
          graph={graph}
          selectedId={selectedId}
          onChange={applyGraph}
          onSelect={setSelectedId}
          resolveTemplate={resolveTemplate}
        />
        {selected && (
          <NodeInspector
            node={selected}
            templateName={selected.ref ? (resolveTemplate(selected.ref)?.name ?? null) : null}
            onChange={(patch) =>
              applyGraph({ ...graph, nodes: graph.nodes.map((nd) => (nd.id === selected.id ? { ...nd, ...patch } : nd)) })
            }
            onDelete={deleteSelected}
          />
        )}
      </div>

      {!loaded && <span className="muted scenario__loading">{t('doc.loading')}</span>}
    </div>
  );
}
