import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DRAFT_RELEASE,
  EMPTY_SCENARIO_GRAPH,
  parseScenarioGraph,
  serializeScenarioGraph,
  type ReleaseDto,
  type ScenarioGraph,
  type ScenarioNode,
  type TemplateType,
} from '@swaft/shared';
import { ApiClient, ApiError } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import {
  Button,
  CloseIcon,
  ConfirmDialog,
  GridIcon,
  IconButton,
  PlayIcon,
  SaveIcon,
  Select,
  SplitButton,
  TrashIcon,
  useToast,
} from '../ui';
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

/** A pending launch awaiting action-authorization: a single/from-here run or a batch. */
type Launch =
  | { kind: 'run'; startNodeId?: string; onlyNode?: boolean }
  | { kind: 'batch'; count: number; interRunDelayMs: number; startNodeId?: string };

/** A right-click context menu open over a node, at screen coordinates. */
type NodeMenu = { node: ScenarioNode; x: number; y: number };

/** The serialized graph source of the selected version: a release's source, else the draft's. */
function scenarioSourceOf(selection: string, draftSource: string, releases: ReleaseDto[]): string {
  if (selection !== DRAFT_RELEASE) {
    const r = releases.find((x) => x.id === selection);
    if (r) return r.source;
  }
  return draftSource;
}

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
 * Scenario View — the visual workflow editor for `scenario` templates. The
 * graph rides in the template `source` as JSON (per selected version: Draft or a named release); this
 * view parses it defensively and edits it on a pan/zoom canvas (drag templates in from the Working
 * Tree, add decision/delay/start nodes, wire and select them). Editing is **explicit-save** (a Save
 * button + Ctrl+S; a dirty dot until saved) with a full undo/redo history. Runs always execute the
 * currently-edited graph — including unsaved changes. A malformed hand-edited source degrades to a
 * read-only error state.
 */
export function ScenarioView({
  client,
  templateId,
  onDirtyChange,
  onTitleChange,
  onOpenTemplate,
}: {
  client: ApiClient;
  templateId: string;
  onDirtyChange?: (dirty: boolean) => void;
  onTitleChange?: (name: string) => void;
  /** Open a referenced template in its own tab (the node context menu's "Edit"). */
  onOpenTemplate?: (id: string, type: TemplateType, name: string) => void;
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
  const [nodeMenu, setNodeMenu] = useState<NodeMenu | null>(null);

  // Editable versions: the Draft plus each named release. `selection` is which one is being edited;
  // every field, save and run targets it. Refs mirror the draft's saved source + the selection so the
  // tree-change reload (a stable closure) reads the current values.
  const [releases, setReleases] = useState<ReleaseDto[]>([]);
  const [releaseSel, setReleaseSel] = useState<string>(DRAFT_RELEASE);
  const releaseSelRef = useRef<string>(DRAFT_RELEASE);
  const draftSourceRef = useRef<string>('');

  // Batch config (moved to the toolbar): repeat `count` runs spaced by `intervalSec` seconds.
  const [count, setCount] = useState(10);
  const [intervalSec, setIntervalSec] = useState(1);

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

  // Apply a version's source to the canvas: parse defensively, reset the undo/redo history and the
  // saved baseline. Never overwrites the graph from an unparseable source.
  const applyVersion = useCallback(
    (source: string) => {
      const { graph: parsed, ok } = parseScenarioGraph(source);
      setParseError(!ok);
      if (ok) {
        setGraph(parsed);
        undoStack.current = [];
        redoStack.current = [];
        coalesceKey.current = null;
        syncHist();
        const normalized = serializeScenarioGraph(parsed);
        savedSourceRef.current = normalized;
        setSavedSource(normalized);
      }
    },
    [syncHist],
  );

  // Load (and reload on external save) the graph for the selected version. Skips the echo of our own
  // save (source === saved) so unsaved edits are not clobbered.
  useEffect(() => {
    let cancelled = false;
    async function load(initial: boolean) {
      try {
        const [tpl, rel, sel] = await Promise.all([
          client.call('template.get', { id: templateId }),
          client.call('release.list', { templateId }),
          initial
            ? client.call('releaseSelection.get', { templateId })
            : Promise.resolve({ releaseId: releaseSelRef.current }),
        ]);
        if (cancelled) return;
        onTitleChange?.(tpl.template.name);
        draftSourceRef.current = tpl.template.source;
        setReleases(rel.releases);
        if (initial) {
          setReleaseSel(sel.releaseId);
          releaseSelRef.current = sel.releaseId;
        }
        const source = scenarioSourceOf(releaseSelRef.current, tpl.template.source, rel.releases);
        const normalized = serializeScenarioGraph(parseScenarioGraph(source).graph);
        if (!initial && normalized === savedSourceRef.current) return; // our own save echoed back
        applyVersion(source);
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    }
    void load(true);
    const unsubscribe = subscribeTreeChanged(() => void load(false));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, templateId, onTitleChange, applyVersion]);

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

  // A run step's referenced template name (best-effort, resolved against the current graph) for the
  // run panel's detail list. Falls back to the node's alias.
  const resolveStepName = useCallback(
    (nodeId: string): string | null => {
      const node = graphRef.current.nodes.find((n) => n.id === nodeId);
      if (node?.ref) return templates.get(node.ref)?.name ?? node.alias ?? null;
      return node?.alias ?? null;
    },
    [templates],
  );

  // Run lifecycle (start/stop/poll/history) + the run panel (always docked, minimizable).
  const runCtl = useScenarioRun(client, templateId);
  const [runMinimized, setRunMinimized] = useState(() => localStorage.getItem(RUN_MIN_KEY) !== 'off');
  // A launch awaiting the action-authorization confirmation: a single run or a batch.
  const [pendingLaunch, setPendingLaunch] = useState<Launch | null>(null);
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

  const launch = useCallback(
    (l: Launch, authorizeActions: boolean) => {
      setRunMinimized(false); // auto-expand the panel when a run starts
      localStorage.setItem(RUN_MIN_KEY, 'off');
      // Always run the currently-edited graph — including unsaved changes.
      const source = serializeScenarioGraph(graphRef.current);
      const go =
        l.kind === 'run'
          ? runCtl.start({ startNodeId: l.startNodeId, onlyNode: l.onlyNode, mode: 'single', authorizeActions, source })
          : runCtl.startBatch({
              count: l.count,
              interRunDelayMs: l.interRunDelayMs,
              startNodeId: l.startNodeId,
              authorizeActions,
              source,
            });
      void go.catch((e) => toast.show(e instanceof ApiError ? e.swaft.message : String(e), 'error'));
    },
    [runCtl, toast],
  );

  /** Launch a run/batch — through the authorization confirmation first when the graph has actions. */
  const request = useCallback(
    (l: Launch) => {
      if (hasActionBlocks) setPendingLaunch(l);
      else launch(l, false);
    },
    [hasActionBlocks, launch],
  );

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
      // Persist to whichever version is being edited: the Draft, or the selected release in place.
      if (releaseSelRef.current === DRAFT_RELEASE) {
        await client.call('template.updateSource', { id: templateId, source });
        draftSourceRef.current = source;
      } else {
        const rel = releases.find((r) => r.id === releaseSelRef.current);
        const res = await client.call('release.update', {
          releaseId: releaseSelRef.current,
          source,
          subtype: rel?.subtype ?? null,
        });
        setReleases(res.releases);
      }
      savedSourceRef.current = source;
      setSavedSource(source);
      notifyTreeChanged();
      toast.show(t('toast.saved'), 'success');
    } catch (e) {
      toast.show(e instanceof ApiError ? e.swaft.message : String(e), 'error');
    }
  }, [client, templateId, releases, toast, t]);

  /** Switch the edited version: load its graph, reset history + baseline, persist the selection. */
  const selectVersion = useCallback(
    (sel: string) => {
      if (sel === releaseSelRef.current) return;
      setReleaseSel(sel);
      releaseSelRef.current = sel;
      setSelection(null);
      applyVersion(scenarioSourceOf(sel, draftSourceRef.current, releases));
      void client.call('releaseSelection.set', { templateId, releaseId: sel }).catch(() => undefined);
    },
    [client, templateId, releases, applyVersion],
  );

  const selectedNode = useMemo(
    () => (selection?.kind === 'node' ? (graph.nodes.find((n) => n.id === selection.id) ?? null) : null),
    [selection, graph.nodes],
  );

  // The start nodes a run can begin from, labelled by alias (or an ordinal).
  const startNodes = useMemo(
    () =>
      graph.nodes
        .filter((n) => n.kind === 'start')
        .map((n, i) => ({ id: n.id, label: n.alias?.trim() || t('scenario.startLabel', { n: i + 1 }) })),
    [graph.nodes, t],
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

  // --- node context menu (right-click) actions ------------------------------
  function menuEdit(node: ScenarioNode) {
    setNodeMenu(null);
    if (node.kind === 'template' && node.ref && node.templateType && onOpenTemplate) {
      onOpenTemplate(node.ref, node.templateType, resolveTemplate(node.ref)?.name ?? node.alias ?? '');
    }
  }
  function menuRun(node: ScenarioNode, onlyNode: boolean) {
    setNodeMenu(null);
    request({ kind: 'run', startNodeId: node.id, onlyNode });
  }
  function menuDelete(node: ScenarioNode) {
    setNodeMenu(null);
    setSelection({ kind: 'node', id: node.id });
    setConfirmDelete(true);
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

  const runActive = runCtl.active || runCtl.batchActive;

  return (
    <div className="scenario">
      <div className="scenario__toolbar">
        {/* Zone: add nodes (one condensed menu) */}
        <SplitButton
          label={t('scenario.add')}
          variant="secondary"
          className="scenario__menu-btn"
          items={[
            { id: 'start', label: t('scenario.addStart') },
            { id: 'decision', label: t('scenario.addDecision') },
            { id: 'delay', label: t('scenario.addDelay') },
          ]}
          onPick={(id) => addControlNode(id as ScenarioNode['kind'])}
        />

        <span className="scenario__toolbar-sep" />
        {/* Zone: edit history + snap */}
        <IconButton label={t('scenario.undo')} disabled={!canUndo} onClick={undo}>
          <UndoGlyph />
        </IconButton>
        <IconButton label={t('scenario.redo')} disabled={!canRedo} onClick={redo}>
          <UndoGlyph flip />
        </IconButton>
        <IconButton
          label={t('scenario.snap')}
          aria-pressed={snapEnabled}
          className={snapEnabled ? 'scenario__snap is-on' : 'scenario__snap'}
          onClick={toggleSnap}
        >
          <GridIcon />
        </IconButton>

        <span className="scenario__toolbar-sep" />
        {/* Zone: run */}
        {runCtl.active ? (
          <Button variant="danger" onClick={() => void runCtl.stop()}>
            {t('scenario.stop')}
          </Button>
        ) : (
          <SplitButton
            label={t('scenario.run')}
            variant="primary"
            className="scenario__menu-btn"
            icon={<PlayIcon />}
            disabled={runActive}
            directWhenSingle
            items={startNodes}
            onPick={(id) => request({ kind: 'run', startNodeId: id })}
          />
        )}

        <span className="scenario__toolbar-sep" />
        {/* Zone: batch */}
        {runCtl.batchActive && runCtl.batch ? (
          <div className="scenario__toolbar-batch">
            <span className="ui-badge">
              {t('scenario.batchRunning', { done: runCtl.batch.completed, total: runCtl.batch.total })}
            </span>
            <Button variant="danger" onClick={() => void runCtl.stopBatch()}>
              {t('scenario.stopBatch')}
            </Button>
          </div>
        ) : (
          <div className="scenario__toolbar-batch">
            <span className="muted">{t('scenario.batchRepeat')}</span>
            <input
              className="ui-input scenario__num"
              type="number"
              min={1}
              max={1000}
              value={count}
              aria-label={t('scenario.batchCount')}
              onChange={(e) => setCount(Math.max(1, Math.min(1000, Math.round(Number(e.target.value) || 1))))}
            />
            <span className="muted">{t('scenario.batchEvery')}</span>
            <input
              className="ui-input scenario__num"
              type="number"
              min={0}
              step={0.5}
              value={intervalSec}
              aria-label={t('scenario.batchInterval')}
              onChange={(e) => setIntervalSec(Math.max(0, Number(e.target.value) || 0))}
            />
            <span className="muted">{t('scenario.batchSeconds')}</span>
            <SplitButton
              label={t('scenario.runBatch')}
              variant="secondary"
              className="scenario__menu-btn"
              icon={<PlayIcon />}
              disabled={runActive}
              directWhenSingle
              items={startNodes}
              onPick={(id) =>
                request({ kind: 'batch', count, interRunDelayMs: Math.round(intervalSec * 1000), startNodeId: id })
              }
            />
          </div>
        )}

        <span className="scenario__toolbar-spacer" />
        {/* Zone: version + save */}
        <Select
          aria-label={t('scenario.release')}
          value={releaseSel}
          onChange={(v) => selectVersion(v)}
          options={[
            { value: DRAFT_RELEASE, label: t('editor.draft') },
            ...releases.map((r) => ({ value: r.id, label: r.name })),
          ]}
        />
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
          onNodeContextMenu={(node, x, y) => setNodeMenu({ node, x, y })}
          onInteract={() => {
            // Any click on the canvas drops the followed run (history highlight + node highlights),
            // unless a run/batch is still live (so live progress is never lost by a stray click).
            if (!runActive) runCtl.clearFocus();
          }}
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
                  onRun={() => request({ kind: 'run', startNodeId: selectedNode.id, onlyNode: true })}
                  onRunFrom={() => request({ kind: 'run', startNodeId: selectedNode.id })}
                  runDisabled={runActive}
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
        resolveNodeName={resolveStepName}
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

      {nodeMenu && (
        <NodeContextMenu
          menu={nodeMenu}
          canEdit={nodeMenu.node.kind === 'template' && !!nodeMenu.node.ref && !!onOpenTemplate}
          onEdit={() => menuEdit(nodeMenu.node)}
          onRun={() => menuRun(nodeMenu.node, true)}
          onRunFrom={() => menuRun(nodeMenu.node, false)}
          onDelete={() => menuDelete(nodeMenu.node)}
          onClose={() => setNodeMenu(null)}
        />
      )}

      <ConfirmDialog
        open={pendingLaunch !== null}
        title={t('scenario.authorizeTitle')}
        message={t('scenario.authorizeMessage')}
        confirmLabel={t('scenario.authorizeConfirm')}
        cancelLabel={t('name.cancel')}
        onConfirm={() => {
          const l = pendingLaunch;
          setPendingLaunch(null);
          if (l) launch(l, true);
        }}
        onClose={() => setPendingLaunch(null)}
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

/** A node's right-click menu (Edit / Run / Run from here / Delete), portalled at the cursor. */
function NodeContextMenu({
  menu,
  canEdit,
  onEdit,
  onRun,
  onRunFrom,
  onDelete,
  onClose,
}: {
  menu: NodeMenu;
  canEdit: boolean;
  onEdit: () => void;
  onRun: () => void;
  onRunFrom: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  const left = Math.min(menu.x, window.innerWidth - 200);
  const top = Math.min(menu.y, window.innerHeight - 180);
  return createPortal(
    <ul
      ref={ref}
      role="menu"
      className="ui-menu"
      style={{ position: 'fixed', top, left }}
    >
      {canEdit && (
        <li role="none">
          <button type="button" role="menuitem" className="ui-menu__item" onClick={onEdit}>
            {t('scenario.edit')}
          </button>
        </li>
      )}
      <li role="none">
        <button type="button" role="menuitem" className="ui-menu__item" onClick={onRun}>
          {t('scenario.runBlock')}
        </button>
      </li>
      <li role="none">
        <button type="button" role="menuitem" className="ui-menu__item" onClick={onRunFrom}>
          {t('scenario.runFromHere')}
        </button>
      </li>
      <li role="none">
        <button type="button" role="menuitem" className="ui-menu__item ui-menu__item--danger" onClick={onDelete}>
          {t('menu.delete')}
        </button>
      </li>
    </ul>,
    document.body,
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
