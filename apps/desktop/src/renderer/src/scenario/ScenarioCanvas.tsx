import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { ScenarioBranch, ScenarioGraph, ScenarioNode, TemplateType } from '@swaft/shared';
import {
  ApiIcon,
  BoltIcon,
  CapabilityIcon,
  DocumentIcon,
  ScenarioIcon,
} from '../ui';
import {
  addEdge,
  edgePath,
  edgeSource,
  edgeTarget,
  moveNode,
  newId,
  nodeSize,
  outputPorts,
  type Point,
} from './graph-model';

/** Zoom bounds for the canvas. */
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.8;

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** A live pointer interaction. Held in a ref so a drag never depends on stale React state. */
type Drag =
  | { kind: 'pan'; startX: number; startY: number; vpX: number; vpY: number }
  | { kind: 'node'; id: string; startX: number; startY: number; nodeX: number; nodeY: number; moved: boolean }
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
 * The scenario canvas: a pan/zoom world of nodes wired by edges, built on native SVG + pointer events
 * (no graph library — see docs `scenarios.md`). Three pointer interactions, each isolated: pan the
 * background, drag a node, or draw an edge from an output port to a target node. All geometry and the
 * edge rules live in the pure `graph-model` module; this component only maps pointers to those
 * mutations and paints the result.
 */
export function ScenarioCanvas({
  graph,
  selectedId,
  onChange,
  onSelect,
  resolveTemplate,
}: {
  graph: ScenarioGraph;
  selectedId: string | null;
  onChange: (graph: ScenarioGraph) => void;
  onSelect: (id: string | null) => void;
  resolveTemplate: (id: string) => ResolvedTemplate | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport>({ x: 40, y: 40, zoom: 1 });
  const drag = useRef<Drag | null>(null);
  // Live cursor position (world coords) while drawing an edge — drives the rubber-band path.
  const [edgeCursor, setEdgeCursor] = useState<Point | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Keep the latest graph/vp reachable from the window listeners without re-subscribing them.
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const vpRef = useRef(vp);
  vpRef.current = vp;

  const screenToWorld = useCallback((clientX: number, clientY: number): Point => {
    const rect = rootRef.current?.getBoundingClientRect();
    const px = clientX - (rect?.left ?? 0);
    const py = clientY - (rect?.top ?? 0);
    const v = vpRef.current;
    return { x: (px - v.x) / v.zoom, y: (py - v.y) / v.zoom };
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

  // Global pointer move/up while any interaction is active. Registered once; reads refs.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = drag.current;
      if (!d) return;
      if (d.kind === 'pan') {
        setVp((v) => ({ ...v, x: d.vpX + (e.clientX - d.startX), y: d.vpY + (e.clientY - d.startY) }));
      } else if (d.kind === 'node') {
        const z = vpRef.current.zoom;
        const dx = (e.clientX - d.startX) / z;
        const dy = (e.clientY - d.startY) / z;
        if (Math.abs(e.clientX - d.startX) > 3 || Math.abs(e.clientY - d.startY) > 3) d.moved = true;
        onChange(moveNode(graphRef.current, d.id, { x: d.nodeX + dx, y: d.nodeY + dy }));
      } else if (d.kind === 'edge') {
        setEdgeCursor(screenToWorld(e.clientX, e.clientY));
      }
    }
    function onUp(e: PointerEvent) {
      const d = drag.current;
      drag.current = null;
      if (d?.kind === 'edge') {
        const target = nodeAt(screenToWorld(e.clientX, e.clientY), d.from);
        if (target) {
          onChange(
            addEdge(graphRef.current, { id: newId('e'), from: d.from, to: target.id, branch: d.branch }),
          );
        }
        setEdgeCursor(null);
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
      const worldX = (cx - v.x) / v.zoom;
      const worldY = (cy - v.y) / v.zoom;
      return { x: cx - worldX * zoom, y: cy - worldY * zoom, zoom };
    });
  }

  function onBackgroundPointerDown(e: ReactPointerEvent) {
    // Only the empty background pans (nodes/ports stop propagation).
    drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, vpX: vp.x, vpY: vp.y };
    onSelect(null);
  }

  function onNodePointerDown(e: ReactPointerEvent, node: ScenarioNode) {
    e.stopPropagation();
    onSelect(node.id);
    drag.current = {
      kind: 'node',
      id: node.id,
      startX: e.clientX,
      startY: e.clientY,
      nodeX: node.position.x,
      nodeY: node.position.y,
      moved: false,
    };
  }

  function onPortPointerDown(e: ReactPointerEvent, node: ScenarioNode, branch: ScenarioBranch | null) {
    e.stopPropagation();
    drag.current = { kind: 'edge', from: node.id, branch };
    setEdgeCursor(screenToWorld(e.clientX, e.clientY));
  }

  // Native DnD: a template dragged from the Working Tree becomes a template node at the drop point.
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
    if (tpl.type === 'document' || tpl.type === 'scenario') return; // only executable blocks
    const p = screenToWorld(e.clientX, e.clientY);
    const { w, h } = nodeSize('template');
    const node: ScenarioNode = {
      id: newId('n'),
      kind: 'template',
      ref: tpl.id,
      templateType: tpl.type,
      alias: slug(tpl.name),
      position: { x: p.x - w / 2, y: p.y - h / 2 },
    };
    onChange({ ...graph, nodes: [...graph.nodes, node] });
    onSelect(node.id);
  }

  const pending =
    drag.current?.kind === 'edge' && edgeCursor
      ? { from: edgeSourcePoint(graph, drag.current.from, drag.current.branch), to: edgeCursor }
      : null;

  return (
    <div
      ref={rootRef}
      className="scenario__canvas"
      data-dragover={dragOver}
      onPointerDown={onBackgroundPointerDown}
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
        <svg className="scenario__edges" width={0} height={0} style={{ overflow: 'visible' }} aria-hidden="true">
          {graph.edges.map((edge) => {
            const a = edgeSource(graph, edge);
            const b = edgeTarget(graph, edge);
            if (!a || !b) return null;
            return (
              <path
                key={edge.id}
                d={edgePath(a, b)}
                className={`scenario-edge scenario-edge--${edge.branch ?? 'plain'}`}
                fill="none"
              />
            );
          })}
          {pending?.from && (
            <path d={edgePath(pending.from, pending.to)} className="scenario-edge scenario-edge--pending" fill="none" />
          )}
        </svg>

        {graph.nodes.map((node) => (
          <NodeView
            key={node.id}
            node={node}
            selected={node.id === selectedId}
            template={node.ref ? resolveTemplate(node.ref) : null}
            onPointerDown={onNodePointerDown}
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
  template,
  onPointerDown,
  onPortPointerDown,
}: {
  node: ScenarioNode;
  selected: boolean;
  template: ResolvedTemplate | null;
  onPointerDown: (e: ReactPointerEvent, node: ScenarioNode) => void;
  onPortPointerDown: (e: ReactPointerEvent, node: ScenarioNode, branch: ScenarioBranch | null) => void;
}) {
  const { w, h } = nodeSize(node.kind);
  const hasInput = node.kind !== 'start';
  const ports = outputPorts(node);
  return (
    <div
      className={`scenario-node scenario-node--${node.kind}${selected ? ' is-selected' : ''}`}
      style={{ left: node.position.x, top: node.position.y, width: w, height: h }}
      draggable={false}
      onPointerDown={(e) => onPointerDown(e, node)}
    >
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
        {node.kind === 'start' && <span className="scenario-node__name">Start</span>}
        {node.kind === 'decision' && (
          <span className="scenario-node__name scenario-node__name--decision">{node.label ?? 'if'}</span>
        )}
        {node.kind === 'delay' && (
          <span className="scenario-node__name">{`Delay ${(node.ms ?? 0) / 1000}s`}</span>
        )}
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
