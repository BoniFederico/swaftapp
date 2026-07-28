import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { ScenarioBranch, ScenarioGraph, ScenarioNode, TemplateType } from '@swaft/shared';
import { ApiIcon, BoltIcon, CapabilityIcon, DocumentIcon, ScenarioIcon } from '../ui';
import {
  GRID,
  addEdge,
  edgePath,
  edgeRejection,
  edgeSource,
  edgeTarget,
  moveNode,
  newId,
  nodeSize,
  outputPorts,
  snapNodePosition,
  type Point,
} from './graph-model';

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.8;

/** What is currently selected on the canvas — a node or an edge. */
export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string };

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** A live pointer interaction, held in a ref so a drag never depends on stale React state. */
type Drag =
  | { kind: 'pan'; startX: number; startY: number; vpX: number; vpY: number }
  | {
      kind: 'node';
      id: string;
      nodeKind: ScenarioNode['kind'];
      startX: number;
      startY: number;
      nodeX: number;
      nodeY: number;
      moved: boolean;
    }
  | { kind: 'edge'; from: string; branch: ScenarioBranch | null };

export interface ResolvedTemplate {
  name: string;
  type: TemplateType;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function TypeGlyph({ type }: { type: TemplateType | undefined }) {
  if (type === 'api') return <ApiIcon className="scenario-node__glyph" />;
  if (type === 'capability') return <CapabilityIcon className="scenario-node__glyph" />;
  if (type === 'action') return <BoltIcon className="scenario-node__glyph" />;
  if (type === 'scenario') return <ScenarioIcon className="scenario-node__glyph" />;
  return <DocumentIcon className="scenario-node__glyph" />;
}

/**
 * The scenario canvas: a pan/zoom world of nodes wired by edges, on native SVG + pointer events (no
 * graph library). Interactions are isolated: pan the background, drag a node
 * (with optional snap-to-grid), draw an edge from an output port to a target node, or click an edge to
 * select it. A node drag is applied locally and emitted as ONE committed change on release, so undo
 * treats a whole drag as a single step. All geometry + edge rules live in the pure `graph-model`.
 */
export function ScenarioCanvas({
  graph,
  selection,
  snapEnabled,
  nodeStatus,
  onChange,
  onSelect,
  onNodeContextMenu,
  onInteract,
  resolveTemplate,
}: {
  graph: ScenarioGraph;
  selection: Selection | null;
  snapEnabled: boolean;
  /** Per-node run status (succeeded/failed/branch/awaiting) for the progress highlight. */
  nodeStatus?: Record<string, string>;
  onChange: (graph: ScenarioGraph) => void;
  onSelect: (sel: Selection | null) => void;
  /** Right-click on a node → open its context menu at the cursor (screen coords). */
  onNodeContextMenu?: (node: ScenarioNode, x: number, y: number) => void;
  /** Any pointer-down anywhere on the canvas (background, node, port or edge). */
  onInteract?: () => void;
  resolveTemplate: (id: string) => ResolvedTemplate | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport>({ x: 40, y: 40, zoom: 1 });
  const drag = useRef<Drag | null>(null);
  // Local, transient position of the node being dragged (committed to the graph only on release).
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  // Live cursor position (world) + hovered drop target while drawing an edge.
  const [edgeCursor, setEdgeCursor] = useState<Point | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [drawing, setDrawing] = useState(false);

  const graphRef = useRef(graph);
  graphRef.current = graph;
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const snapRef = useRef(snapEnabled);
  snapRef.current = snapEnabled;

  const screenToWorld = useCallback((clientX: number, clientY: number): Point => {
    const rect = rootRef.current?.getBoundingClientRect();
    const v = vpRef.current;
    return { x: (clientX - (rect?.left ?? 0) - v.x) / v.zoom, y: (clientY - (rect?.top ?? 0) - v.y) / v.zoom };
  }, []);

  /** The topmost node (excluding `exceptId`) whose box contains a world point — the edge drop target. */
  const nodeAt = useCallback((p: Point, exceptId: string): ScenarioNode | null => {
    const nodes = graphRef.current.nodes;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]!;
      if (n.id === exceptId) continue;
      const { w, h } = nodeSize(n.kind);
      if (p.x >= n.position.x && p.x <= n.position.x + w && p.y >= n.position.y && p.y <= n.position.y + h) {
        return n;
      }
    }
    return null;
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = drag.current;
      if (!d) return;
      if (d.kind === 'pan') {
        setVp((v) => ({ ...v, x: d.vpX + (e.clientX - d.startX), y: d.vpY + (e.clientY - d.startY) }));
      } else if (d.kind === 'node') {
        const z = vpRef.current.zoom;
        if (Math.abs(e.clientX - d.startX) > 2 || Math.abs(e.clientY - d.startY) > 2) d.moved = true;
        let pos: Point = { x: d.nodeX + (e.clientX - d.startX) / z, y: d.nodeY + (e.clientY - d.startY) / z };
        if (snapRef.current) pos = snapNodePosition(d.nodeKind, pos);
        setDragPos({ id: d.id, x: pos.x, y: pos.y });
      } else if (d.kind === 'edge') {
        const p = screenToWorld(e.clientX, e.clientY);
        setEdgeCursor(p);
        const target = nodeAt(p, d.from);
        setDropTargetId(target && !edgeRejection(graphRef.current, d.from, target.id, d.branch) ? target.id : null);
      }
    }
    function onUp(e: PointerEvent) {
      const d = drag.current;
      drag.current = null;
      if (d?.kind === 'node') {
        if (d.moved) {
          const z = vpRef.current.zoom;
          let pos: Point = { x: d.nodeX + (e.clientX - d.startX) / z, y: d.nodeY + (e.clientY - d.startY) / z };
          if (snapRef.current) pos = snapNodePosition(d.nodeKind, pos);
          onChange(moveNode(graphRef.current, d.id, pos));
        }
        setDragPos(null);
      } else if (d?.kind === 'edge') {
        const target = nodeAt(screenToWorld(e.clientX, e.clientY), d.from);
        if (target && !edgeRejection(graphRef.current, d.from, target.id, d.branch)) {
          onChange(addEdge(graphRef.current, { id: newId('e'), from: d.from, to: target.id, branch: d.branch }));
        }
        setEdgeCursor(null);
        setDropTargetId(null);
        setDrawing(false);
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [onChange, screenToWorld, nodeAt]);

  function onWheel(e: ReactWheelEvent) {
    e.preventDefault();
    const rect = rootRef.current?.getBoundingClientRect();
    const cx = e.clientX - (rect?.left ?? 0);
    const cy = e.clientY - (rect?.top ?? 0);
    setVp((v) => {
      const zoom = clamp(v.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), MIN_ZOOM, MAX_ZOOM);
      return { x: cx - ((cx - v.x) / v.zoom) * zoom, y: cy - ((cy - v.y) / v.zoom) * zoom, zoom };
    });
  }

  function onBackgroundPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return; // right-click is reserved for context menus
    // Only pans. A single canvas click keeps the selection/detail panel — it is cleared with a
    // double-click on empty space (see onBackgroundDoubleClick) or the panel's × button.
    drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, vpX: vp.x, vpY: vp.y };
  }

  function onBackgroundDoubleClick(e: ReactMouseEvent) {
    // Double-clicking empty canvas clears the selection (and so closes the detail inspector). A
    // double-click that lands on a node or an edge is ignored.
    const el = e.target as HTMLElement;
    if (el.closest('.scenario-node') || el.closest('.scenario-edge-hit') || el.closest('.scenario-edge')) return;
    onSelect(null);
  }

  function onNodePointerDown(e: ReactPointerEvent, node: ScenarioNode) {
    e.stopPropagation();
    if (e.button !== 0) return; // right-click → context menu, not a drag
    onSelect({ kind: 'node', id: node.id });
    drag.current = {
      kind: 'node',
      id: node.id,
      nodeKind: node.kind,
      startX: e.clientX,
      startY: e.clientY,
      nodeX: node.position.x,
      nodeY: node.position.y,
      moved: false,
    };
  }

  function onNodeContext(e: ReactMouseEvent, node: ScenarioNode) {
    e.preventDefault();
    e.stopPropagation();
    onSelect({ kind: 'node', id: node.id });
    onNodeContextMenu?.(node, e.clientX, e.clientY);
  }

  function onPortPointerDown(e: ReactPointerEvent, node: ScenarioNode, branch: ScenarioBranch | null) {
    e.stopPropagation();
    if (e.button !== 0) return;
    drag.current = { kind: 'edge', from: node.id, branch };
    setDrawing(true);
    setEdgeCursor(screenToWorld(e.clientX, e.clientY));
  }

  function onDrop(e: ReactDragEvent) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData('application/swaft-template');
    if (!raw) return;
    let tpl: { id: string; name: string; type: TemplateType };
    try {
      tpl = JSON.parse(raw);
    } catch {
      return;
    }
    if (tpl.type === 'scenario') return; // only executable blocks (documents render like api/action blocks)
    const p = screenToWorld(e.clientX, e.clientY);
    const { w, h } = nodeSize('template');
    let position: Point = { x: p.x - w / 2, y: p.y - h / 2 };
    if (snapEnabled) position = snapNodePosition('template', position);
    const node: ScenarioNode = {
      id: newId('n'),
      kind: 'template',
      ref: tpl.id,
      templateType: tpl.type,
      alias: slug(tpl.name),
      position,
    };
    onChange({ ...graph, nodes: [...graph.nodes, node] });
    onSelect({ kind: 'node', id: node.id });
  }

  // The graph as displayed: the dragged node shown at its live (snapped) position so its edges follow.
  const shown = dragPos ? moveNode(graph, dragPos.id, { x: dragPos.x, y: dragPos.y }) : graph;
  const pending =
    drawing && edgeCursor && drag.current?.kind === 'edge'
      ? { from: edgeSourcePoint(shown, drag.current.from, drag.current.branch), to: edgeCursor }
      : null;

  return (
    <div
      ref={rootRef}
      className={`scenario__canvas${drawing ? ' is-drawing' : ''}`}
      data-dragover={dragOver}
      style={{
        backgroundSize: `${GRID * vp.zoom}px ${GRID * vp.zoom}px`,
        backgroundPosition: `${vp.x}px ${vp.y}px`,
      }}
      onPointerDownCapture={() => onInteract?.()}
      onPointerDown={onBackgroundPointerDown}
      onDoubleClick={onBackgroundDoubleClick}
      onWheel={onWheel}
      onDragOver={(e: ReactDragEvent) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div
        className="scenario__world"
        style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`, transformOrigin: '0 0' }}
      >
        <svg className="scenario__edges" aria-hidden="true">
          {shown.edges.map((edge) => {
            const a = edgeSource(shown, edge);
            const b = edgeTarget(shown, edge);
            if (!a || !b) return null;
            const d = edgePath(a, b);
            const sel = selection?.kind === 'edge' && selection.id === edge.id;
            return (
              <g key={edge.id}>
                {/* Fat, invisible hit path so a thin edge is easy to click/select. */}
                <path
                  d={d}
                  className="scenario-edge-hit"
                  fill="none"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: 'edge', id: edge.id });
                  }}
                />
                <path
                  d={d}
                  className={`scenario-edge scenario-edge--${edge.branch ?? 'plain'}${sel ? ' is-selected' : ''}`}
                  fill="none"
                />
              </g>
            );
          })}
          {pending?.from && (
            <path d={edgePath(pending.from, pending.to)} className="scenario-edge scenario-edge--pending" fill="none" />
          )}
        </svg>

        {shown.nodes.map((node) => (
          <NodeView
            key={node.id}
            node={node}
            selected={selection?.kind === 'node' && selection.id === node.id}
            dropTarget={dropTargetId === node.id}
            runStatus={nodeStatus?.[node.id]}
            template={node.ref ? resolveTemplate(node.ref) : null}
            onPointerDown={onNodePointerDown}
            onContextMenu={onNodeContext}
            onPortPointerDown={onPortPointerDown}
          />
        ))}
      </div>
    </div>
  );
}

/** A single node: kind-specific body + its input/output port handles. */
function NodeView({
  node,
  selected,
  dropTarget,
  runStatus,
  template,
  onPointerDown,
  onContextMenu,
  onPortPointerDown,
}: {
  node: ScenarioNode;
  selected: boolean;
  dropTarget: boolean;
  runStatus?: string;
  template: ResolvedTemplate | null;
  onPointerDown: (e: ReactPointerEvent, node: ScenarioNode) => void;
  onContextMenu: (e: ReactMouseEvent, node: ScenarioNode) => void;
  onPortPointerDown: (e: ReactPointerEvent, node: ScenarioNode, branch: ScenarioBranch | null) => void;
}) {
  const { w, h } = nodeSize(node.kind);
  const hasInput = node.kind !== 'start';
  const ports = outputPorts(node);
  const cls =
    `scenario-node scenario-node--${node.kind}` +
    `${selected ? ' is-selected' : ''}${dropTarget ? ' is-drop-target' : ''}` +
    `${runStatus ? ` scenario-node--run-${runStatus}` : ''}` +
    `${node.breakpoint ? ' has-breakpoint' : ''}`;
  return (
    <div
      className={cls}
      style={{ left: node.position.x, top: node.position.y, width: w, height: h }}
      draggable={false}
      onPointerDown={(e) => onPointerDown(e, node)}
      onContextMenu={(e) => onContextMenu(e, node)}
    >
      {node.kind === 'template' && (
        <span className="scenario-node__breakpoint" aria-hidden="true" title="Breakpoint" />
      )}
      {node.kind === 'decision' && (
        <svg className="scenario-node__diamond" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          <polygon points={`${w / 2},3 ${w - 3},${h / 2} ${w / 2},${h - 3} 3,${h / 2}`} />
        </svg>
      )}
      <div className="scenario-node__body">
        {node.kind === 'template' && (
          <>
            <TypeGlyph type={node.templateType} />
            <div className="scenario-node__labels">
              <span className="scenario-node__name">{template?.name ?? node.alias ?? node.ref ?? '—'}</span>
              {node.alias && <span className="scenario-node__alias">{node.alias}</span>}
            </div>
          </>
        )}
        {node.kind === 'start' && (
          <div className="scenario-node__labels scenario-node__labels--center">
            <span className="scenario-node__name">Start</span>
            {node.alias && <span className="scenario-node__alias">{node.alias}</span>}
          </div>
        )}
        {node.kind === 'decision' && (
          <span className="scenario-node__name scenario-node__name--decision">{node.label ?? 'if'}</span>
        )}
        {node.kind === 'delay' && <span className="scenario-node__name">{`Delay ${(node.ms ?? 0) / 1000}s`}</span>}
      </div>

      {hasInput && <span className="scenario-port scenario-port--in" style={{ top: h / 2 }} aria-hidden="true" />}
      {ports.map((p) => (
        <span
          key={p.branch ?? 'out'}
          className={`scenario-port scenario-port--out scenario-port--${p.branch ?? 'plain'}`}
          style={{ top: p.y - node.position.y }}
          title={p.branch ?? undefined}
          onPointerDown={(e) => onPortPointerDown(e, node, p.branch)}
        >
          {p.branch === 'true' ? 'T' : p.branch === 'false' ? 'F' : ''}
        </span>
      ))}
    </div>
  );
}

/** The world anchor an in-progress edge leaves from (source node's port). */
function edgeSourcePoint(graph: ScenarioGraph, from: string, branch: ScenarioBranch | null): Point | null {
  const node = graph.nodes.find((n) => n.id === from);
  if (!node) return null;
  const ports = outputPorts(node);
  return (branch ? ports.find((p) => p.branch === branch) : ports[0]) ?? null;
}

/** A readable default alias from a template name (identifier-ish, for `previous('alias')`). */
export function slug(name: string): string {
  const s = name
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, '_$1');
  return s || 'block';
}
