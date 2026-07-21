import type { ScenarioBranch, ScenarioEdge, ScenarioGraph, ScenarioNode } from '@swaft/shared';

/**
 * Pure geometry + immutable graph mutations for the scenario canvas. No React, no DOM — everything
 * here is deterministic and unit-tested, so the canvas component can stay thin and the tricky rules
 * (single-outgoing edges, decision branches, cascade-delete) live in one audited place.
 *
 * Coordinates are **world** units (the graph model's own space); the canvas applies pan/zoom on top.
 * A node's `position` is its top-left corner.
 */

export interface Size {
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface Port extends Point {
  /** null for a plain output; the branch for a decision's two outputs. */
  branch: ScenarioBranch | null;
}

/** Fixed on-canvas size per node kind (world units). */
export function nodeSize(kind: ScenarioNode['kind']): Size {
  switch (kind) {
    case 'start':
      return { w: 120, h: 44 };
    case 'decision':
      return { w: 108, h: 108 };
    case 'delay':
      return { w: 132, h: 52 };
    default:
      return { w: 184, h: 68 };
  }
}

/** The single input anchor (left-center). Start nodes have no input (they are entry-only). */
export function inputPort(node: ScenarioNode): Point | null {
  if (node.kind === 'start') return null;
  const { h } = nodeSize(node.kind);
  return { x: node.position.x, y: node.position.y + h / 2 };
}

/**
 * Output anchors. A decision exposes two (true upper-right, false lower-right); every other kind
 * exposes one (right-center). Returned in a stable order for rendering + hit-testing.
 */
export function outputPorts(node: ScenarioNode): Port[] {
  const { w, h } = nodeSize(node.kind);
  const right = node.position.x + w;
  if (node.kind === 'decision') {
    return [
      { branch: 'true', x: right, y: node.position.y + h * 0.32 },
      { branch: 'false', x: right, y: node.position.y + h * 0.68 },
    ];
  }
  return [{ branch: null, x: right, y: node.position.y + h / 2 }];
}

/** A horizontal S-curve (cubic Bézier) between two anchors — the edge path. */
export function edgePath(a: Point, b: Point): string {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

/** The anchor an edge leaves from (honoring the source's branch), or null if the node/port is gone. */
export function edgeSource(graph: ScenarioGraph, edge: ScenarioEdge): Point | null {
  const node = graph.nodes.find((n) => n.id === edge.from);
  if (!node) return null;
  const ports = outputPorts(node);
  const port = edge.branch ? ports.find((p) => p.branch === edge.branch) : ports[0];
  return port ?? null;
}

/** The anchor an edge arrives at (the target's input), or null if the node is gone. */
export function edgeTarget(graph: ScenarioGraph, edge: ScenarioEdge): Point | null {
  const node = graph.nodes.find((n) => n.id === edge.to);
  return node ? inputPort(node) : null;
}

// --- immutable mutations ----------------------------------------------------

export function addNode(graph: ScenarioGraph, node: ScenarioNode): ScenarioGraph {
  return { ...graph, nodes: [...graph.nodes, node] };
}

export function moveNode(graph: ScenarioGraph, id: string, position: Point): ScenarioGraph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, position } : n)) };
}

export function updateNode(
  graph: ScenarioGraph,
  id: string,
  patch: Partial<ScenarioNode>,
): ScenarioGraph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

/** Remove a node and every edge touching it (cascade). */
export function removeNode(graph: ScenarioGraph, id: string): ScenarioGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== id),
    edges: graph.edges.filter((e) => e.from !== id && e.to !== id),
  };
}

export function removeEdge(graph: ScenarioGraph, id: string): ScenarioGraph {
  return { ...graph, edges: graph.edges.filter((e) => e.id !== id) };
}

/**
 * Why an edge would be rejected (or null if it is allowed). Enforces the single-active-path model:
 * no self-loops, no duplicate, no edges into a `start`, decision outputs carry a branch (one per
 * branch), and every other node has at most one outgoing edge.
 */
export function edgeRejection(
  graph: ScenarioGraph,
  from: string,
  to: string,
  branch: ScenarioBranch | null,
): 'self' | 'duplicate' | 'into-start' | 'branch-mismatch' | null {
  if (from === to) return 'self';
  const source = graph.nodes.find((n) => n.id === from);
  const target = graph.nodes.find((n) => n.id === to);
  if (!source || !target) return 'self';
  if (target.kind === 'start') return 'into-start';
  const isDecision = source.kind === 'decision';
  if (isDecision && branch == null) return 'branch-mismatch';
  if (!isDecision && branch != null) return 'branch-mismatch';
  const dup = graph.edges.some((e) => e.from === from && e.to === to && (e.branch ?? null) === branch);
  if (dup) return 'duplicate';
  return null;
}

/**
 * Add an edge, enforcing the rules in {@link edgeRejection} and the "one edge per output port"
 * invariant: a new edge from a port **replaces** any existing edge on that same port (a decision's
 * true/false ports are independent; every other node has a single port). Returns the graph unchanged
 * if the edge is rejected.
 */
export function addEdge(graph: ScenarioGraph, edge: ScenarioEdge): ScenarioGraph {
  const branch = edge.branch ?? null;
  if (edgeRejection(graph, edge.from, edge.to, branch)) return graph;
  // Drop any edge already leaving the same output port (same source + same branch).
  const edges = graph.edges.filter(
    (e) => !(e.from === edge.from && (e.branch ?? null) === branch),
  );
  return { ...graph, edges: [...edges, { ...edge, branch }] };
}

/** A fresh unique id for a node/edge. Uses the platform UUID (available in the renderer). */
export function newId(prefix: 'n' | 'e'): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `${prefix}_${uuid.slice(0, 12)}`;
}
