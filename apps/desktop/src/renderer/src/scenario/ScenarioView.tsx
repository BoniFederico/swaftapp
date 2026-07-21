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
import { Button, CloseIcon, ConfirmDialog, IconButton, SaveIcon, TrashIcon, useToast } from '../ui';
import { notifyTreeChanged, subscribeTreeChanged } from '../workspace/treeBus';
import { newId, removeEdge, removeNode } from './graph-model';
import { NodeInspector } from './NodeInspector';
import { ScenarioCanvas, type ResolvedTemplate, type Selection } from './ScenarioCanvas';
import { ScenarioRunPanel } from './ScenarioRunPanel';
import { useScenarioRun } from './useScenarioRun';

const SNAP_KEY = 'swaft:scenarioSnap';
const INSPECTOR_W_KEY = 'swaft:scenarioInspectorW';
const RUN_H_KEY = 'swaft:scenarioRunH';
const RUN_HISTORY_W_KEY = 'swaft:scenarioRunHistoryW';
const RUN_MIN_KEY = 'swaft:scenarioRunMin';
const MIN_INSPECTOR = 240;
const MAX_INSPECTOR = 520;
const MIN_RUN_H = 120;
const MAX_RUN_H = 520;
const MIN_HISTORY = 160;
const MAX_HISTORY = 460;

/** Read a persisted pixel size, clamped, or a default. */
function storedSize(key: string, def: number, min: number, max: number): number {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v >= min && v <= max ? v : def;
}

/**
 * A drag-to-resize handler shared by the inspector width, the run panel height, and the run history
 * width — dragging *toward* the content grows it (base + start − current). Persists on release.
 */
function beginResize(
  e: React.PointerEvent,
  axis: 'x' | 'y',
  base: number,
  min: number,
  max: number,
  set: (v: number) => void,
  key: string,
): void {
  e.preventDefault();
  const start = axis === 'x' ? e.clientX : e.clientY;
  let latest = base;
  const onMove = (ev: PointerEvent) => {
    const cur = axis === 'x' ? ev.clientX : ev.clientY;
    latest = Math.max(min, Math.min(max, base + (start - cur)));
    set(latest);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    localStorage.setItem(key, String(Math.round(latest)));
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/**
 * Scenario View — the visual workflow editor for `scenario` templates (see docs `scenarios.md`). The
 * graph rides in the template `source` as JSON; this view parses it defensively and edits it on a
 * pan/zoom canvas (drag templates in from the Working Tree, add decision/delay/start nodes, wire and
 * select them). Editing is **explicit-save** (a Save button + Ctrl+S; a dirty dot until saved) with a
 * full undo/redo history. A malformed hand-edited source degrades to a read-only error state.
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
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [parseError, setParseError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [templates, setTemplates] = useState<Map<string, ResolvedTemplate>>(new Map());
  const [snapEnabled, setSnapEnabled] = useState(() => localStorage.getItem(SNAP_KEY) !== 'off');
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    storedSize(INSPECTOR_W_KEY, 300, MIN_INSPECTOR, MAX_INSPECTOR),
  );
  const [runPanelHeight, setRunPanelHeight] = useState(() =>
    storedSize(RUN_H_KEY, 220, MIN_RUN_H, MAX_RUN_H),
  );
  const [runHistoryWidth, setRunHistoryWidth] = useState(() =>
    storedSize(RUN_HISTORY_W_KEY, 260, MIN_HISTORY, MAX_HISTORY),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Undo / redo history + the saved baseline for the dirty flag. Stacks are refs (they never drive a
  // render on their own); a version counter re-renders so the toolbar's enabled state stays in sync.
  const undoStack = useRef<ScenarioGraph[]>([]);
  const redoStack = useRef<ScenarioGraph[]>([]);
  const coalesceKey = useRef<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const syncHist = useCallback(() => {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  }, []);
  const savedSourceRef = useRef<string | null>(null);
  const [savedSource, setSavedSource] = useState<string | null>(null);

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
          undoStack.current = [];
          redoStack.current = [];
          syncHist();
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
  }, [client, templateId, onTitleChange, syncHist]);

  // Templates a scenario can reference (executable kinds): id → { name, type }.
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

  // Run lifecycle (start/stop/poll/history) + the run panel (always docked, minimizable).
  const runCtl = useScenarioRun(client, templateId);
  const [runMinimized, setRunMinimized] = useState(() => localStorage.getItem(RUN_MIN_KEY) !== 'off');
  const [confirmRun, setConfirmRun] = useState<{ startNodeId?: string } | null>(null);
  function toggleRunMinimized() {
    setRunMinimized((m) => {
      localStorage.setItem(RUN_MIN_KEY, m ? 'off' : 'on');
      return !m;
    });
  }
  /** True when any block references an action template (an effect) → a run needs authorization. */
  const hasActionBlocks = useMemo(
    () =>
      graph.nodes.some(
        (n) => n.kind === 'template' && (n.templateType === 'action' || templates.get(n.ref ?? '')?.type === 'action'),
      ),
    [graph.nodes, templates],
  );

  const startRun = useCallback(
    (authorizeActions: boolean, startNodeId?: string) => {
      setRunMinimized(false); // auto-expand the panel when a run starts
      localStorage.setItem(RUN_MIN_KEY, 'off');
      void runCtl.start({ startNodeId, mode: 'single', authorizeActions }).catch((e) =>
        toast.show(e instanceof ApiError ? e.swaft.message : String(e), 'error'),
      );
    },
    [runCtl, toast],
  );

  function requestRun() {
    // Run from the selected node if one is picked, else from the graph's start node.
    const startNodeId = selection?.kind === 'node' ? selection.id : undefined;
    if (hasActionBlocks) setConfirmRun({ startNodeId });
    else startRun(false, startNodeId);
  }

  /**
   * Apply a graph change and record it for undo. `coalesce` groups consecutive edits under the same key
   * (e.g. typing in one inspector field) into a single undo step; a different/absent key starts a new
   * step. The canvas never coalesces (each drag/edge/drop is its own step).
   */
  const commit = useCallback(
    (next: ScenarioGraph, coalesce?: string) => {
      if (coalesce && coalesce === coalesceKey.current) {
        setGraph(next);
        return;
      }
      undoStack.current.push(graphRef.current);
      redoStack.current = [];
      coalesceKey.current = coalesce ?? null;
      setGraph(next);
      syncHist();
    },
    [syncHist],
  );

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    redoStack.current.push(graphRef.current);
    setGraph(undoStack.current.pop()!);
    coalesceKey.current = null;
    setSelection(null);
    syncHist();
  }, [syncHist]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    undoStack.current.push(graphRef.current);
    setGraph(redoStack.current.pop()!);
    coalesceKey.current = null;
    setSelection(null);
    syncHist();
  }, [syncHist]);

  const dirty = savedSource !== null && !parseError && serializeScenarioGraph(graph) !== savedSource;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const save = useCallback(async () => {
    const source = serializeScenarioGraph(graphRef.current);
    if (source === savedSourceRef.current) return;
    try {
      await client.call('template.updateSource', { id: templateId, source });
      savedSourceRef.current = source;
      setSavedSource(source);
      notifyTreeChanged();
      toast.show(t('toast.saved'), 'success');
    } catch (e) {
      toast.show(e instanceof ApiError ? e.swaft.message : String(e), 'error');
    }
  }, [client, templateId, toast, t]);

  const selectedNode = useMemo(
    () => (selection?.kind === 'node' ? (graph.nodes.find((n) => n.id === selection.id) ?? null) : null),
    [selection, graph.nodes],
  );

  function addControlNode(kind: ScenarioNode['kind']) {
    const n = graph.nodes.length;
    const node: ScenarioNode = {
      id: newId('n'),
      kind,
      position: { x: 160 + (n % 5) * 40, y: 200 + (n % 5) * 40 },
      ...(kind === 'delay' ? { ms: 1000 } : {}),
      ...(kind === 'decision' ? { condition: '' } : {}),
    };
    commit({ ...graph, nodes: [...graph.nodes, node] });
    setSelection({ kind: 'node', id: node.id });
  }

  const deleteSelection = useCallback(() => {
    const sel = selection;
    if (!sel) return;
    commit(sel.kind === 'node' ? removeNode(graphRef.current, sel.id) : removeEdge(graphRef.current, sel.id));
    setSelection(null);
  }, [selection, commit]);

  // Keyboard: delete selection, undo/redo, save — ignored while a text field has focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault();
        deleteSelection();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, undo, redo, deleteSelection, selection]);

  function toggleSnap() {
    setSnapEnabled((s) => {
      const next = !s;
      localStorage.setItem(SNAP_KEY, next ? 'on' : 'off');
      return next;
    });
  }

  function requestDelete() {
    if (selection) setConfirmDelete(true);
  }

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
        <span className="scenario__toolbar-sep" />
        <IconButton label={t('scenario.undo')} disabled={!canUndo} onClick={undo}>
          <UndoGlyph />
        </IconButton>
        <IconButton label={t('scenario.redo')} disabled={!canRedo} onClick={redo}>
          <UndoGlyph flip />
        </IconButton>
        <Button
          variant={snapEnabled ? 'secondary' : 'ghost'}
          className={snapEnabled ? 'scenario__snap is-on' : 'scenario__snap'}
          aria-pressed={snapEnabled}
          onClick={toggleSnap}
        >
          {t('scenario.snap')}
        </Button>
        <span className="scenario__toolbar-sep" />
        {runCtl.active ? (
          <Button variant="danger" onClick={() => void runCtl.stop()}>
            {t('scenario.stop')}
          </Button>
        ) : (
          <Button variant="primary" className="scenario__run-btn" onClick={requestRun}>
            {selection?.kind === 'node' ? t('scenario.runFromHere') : t('scenario.run')}
          </Button>
        )}
        <span className="scenario__toolbar-hint muted">{t('scenario.dropHint')}</span>
        <Button variant="primary" disabled={!dirty} onClick={() => void save()}>
          <SaveIcon />
          <span>{t('scenario.save')}</span>
        </Button>
      </div>

      <div className="scenario__main">
        <ScenarioCanvas
          graph={graph}
          selection={selection}
          snapEnabled={snapEnabled}
          nodeStatus={runCtl.nodeStatus}
          onChange={(next) => commit(next)}
          onSelect={setSelection}
          resolveTemplate={resolveTemplate}
        />
        {selection && (
          <div className="scenario-inspector-float" style={{ width: inspectorWidth }}>
            <div
              className="scenario-inspector-float__resize"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('scenario.resizeInspector')}
              onPointerDown={(e) =>
                beginResize(e, 'x', inspectorWidth, MIN_INSPECTOR, MAX_INSPECTOR, setInspectorWidth, INSPECTOR_W_KEY)
              }
            />
            {selectedNode ? (
                <NodeInspector
                  node={selectedNode}
                  templateName={selectedNode.ref ? (resolveTemplate(selectedNode.ref)?.name ?? null) : null}
                  onChange={(patch, field) =>
                    commit(
                      { ...graph, nodes: graph.nodes.map((nd) => (nd.id === selectedNode.id ? { ...nd, ...patch } : nd)) },
                      field ? `field:${selectedNode.id}:${field}` : undefined,
                    )
                  }
                  onDelete={requestDelete}
                  onClose={() => setSelection(null)}
                />
              ) : (
                <aside className="scenario-inspector" aria-label={t('scenario.inspector')}>
                  <div className="scenario-inspector__head">
                    <span className="scenario-inspector__kind">{t('scenario.kind.edge')}</span>
                    <span className="scenario-inspector__head-actions">
                      <IconButton label={t('scenario.deleteEdge')} onClick={requestDelete}>
                        <TrashIcon />
                      </IconButton>
                      <IconButton label={t('scenario.closeInspector')} onClick={() => setSelection(null)}>
                        <CloseIcon />
                      </IconButton>
                    </span>
                  </div>
                  <div className="scenario-inspector__body">
                    <span className="muted">{t('scenario.edgeHint')}</span>
                  </div>
                </aside>
              )}
          </div>
        )}
      </div>

      <ScenarioRunPanel
        controller={runCtl}
        minimized={runMinimized}
        onToggleMinimize={toggleRunMinimized}
        height={runPanelHeight}
        historyWidth={runHistoryWidth}
        onResize={(e) =>
          beginResize(e, 'y', runPanelHeight, MIN_RUN_H, MAX_RUN_H, setRunPanelHeight, RUN_H_KEY)
        }
        onHistoryResize={(e) =>
          beginResize(e, 'x', runHistoryWidth, MIN_HISTORY, MAX_HISTORY, setRunHistoryWidth, RUN_HISTORY_W_KEY)
        }
      />

      <ConfirmDialog
        open={confirmRun !== null}
        title={t('scenario.authorizeTitle')}
        message={t('scenario.authorizeMessage')}
        confirmLabel={t('scenario.authorizeConfirm')}
        cancelLabel={t('name.cancel')}
        onConfirm={() => {
          const start = confirmRun ?? {};
          setConfirmRun(null);
          startRun(true, start.startNodeId);
        }}
        onClose={() => setConfirmRun(null)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={t('confirm.title')}
        message={selection?.kind === 'edge' ? t('scenario.confirmDeleteEdge') : t('scenario.confirmDeleteNode')}
        confirmLabel={t('menu.delete')}
        cancelLabel={t('name.cancel')}
        onConfirm={() => {
          setConfirmDelete(false);
          deleteSelection();
        }}
        onClose={() => setConfirmDelete(false)}
      />

      {!loaded && <span className="muted scenario__loading">{t('doc.loading')}</span>}
    </div>
  );
}

/** Curved undo arrow (flip for redo). */
function UndoGlyph({ flip }: { flip?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" />
    </svg>
  );
}
