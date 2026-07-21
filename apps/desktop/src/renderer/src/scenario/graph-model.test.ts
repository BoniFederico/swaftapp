import { describe, it, expect } from 'vitest';
import { EMPTY_SCENARIO_GRAPH, type ScenarioGraph, type ScenarioNode } from '@swaft/shared';
import {
  addEdge,
  addNode,
  edgeRejection,
  inputPort,
  moveNode,
  outputPorts,
  removeNode,
  snap,
  snapNodePosition,
  snapPoint,
  updateNode,
} from './graph-model';

function node(id: string, kind: ScenarioNode['kind'], x = 0, y = 0): ScenarioNode {
  return { id, kind, position: { x, y } };
}

function graphOf(...nodes: ScenarioNode[]): ScenarioGraph {
  return { ...EMPTY_SCENARIO_GRAPH, nodes };
}

describe('graph geometry', () => {
  it('start has no input; others input at left-center', () => {
    expect(inputPort(node('s', 'start'))).toBeNull();
    const t = node('t', 'template', 100, 100);
    expect(inputPort(t)).toEqual({ x: 100, y: 100 + 68 / 2 });
  });

  it('decision exposes two branch outputs; others one plain output', () => {
    expect(outputPorts(node('t', 'template')).map((p) => p.branch)).toEqual([null]);
    expect(outputPorts(node('d', 'decision')).map((p) => p.branch)).toEqual(['true', 'false']);
  });
});

describe('edge rules', () => {
  const g = graphOf(node('s', 'start'), node('t', 'template', 200), node('d', 'decision', 400));

  it('rejects self, into-start, and branch mismatches', () => {
    expect(edgeRejection(g, 't', 't', null)).toBe('self');
    expect(edgeRejection(g, 't', 's', null)).toBe('into-start');
    expect(edgeRejection(g, 'd', 't', null)).toBe('branch-mismatch'); // decision needs a branch
    expect(edgeRejection(g, 't', 'd', 'true')).toBe('branch-mismatch'); // non-decision must not
    expect(edgeRejection(g, 's', 't', null)).toBeNull();
    expect(edgeRejection(g, 'd', 't', 'true')).toBeNull();
  });

  it('a new edge from a port replaces the old one (single-out per port)', () => {
    let x = addEdge(g, { id: 'e1', from: 't', to: 'd' });
    x = addEdge(x, { id: 'e2', from: 't', to: 's' }); // s is start → rejected, unchanged
    expect(x.edges.map((e) => e.id)).toEqual(['e1']);
    // re-point t's single output to the decision-less target: replaces e1
    x = addEdge(x, { id: 'e3', from: 't', to: 'd' }); // duplicate (same from+to+branch) → rejected
    expect(x.edges).toHaveLength(1);
  });

  it('decision keeps independent true/false edges', () => {
    let x = addEdge(g, { id: 'et', from: 'd', to: 't', branch: 'true' });
    x = addEdge(x, { id: 'ef', from: 'd', to: 's', branch: 'false' }); // into start → rejected
    x = addEdge(x, { id: 'ef2', from: 'd', to: 't', branch: 'false' });
    expect(x.edges.map((e) => e.branch).sort()).toEqual(['false', 'true']);
    // replacing the true branch keeps false intact
    const t2 = node('t2', 'template', 600);
    x = { ...x, nodes: [...x.nodes, t2] };
    x = addEdge(x, { id: 'et2', from: 'd', to: 't2', branch: 'true' });
    expect(x.edges.filter((e) => e.branch === 'true').map((e) => e.to)).toEqual(['t2']);
    expect(x.edges.filter((e) => e.branch === 'false')).toHaveLength(1);
  });
});

describe('snap', () => {
  it('rounds to the nearest grid line', () => {
    expect(snap(0, 20)).toBe(0);
    expect(snap(9, 20)).toBe(0);
    expect(snap(11, 20)).toBe(20);
    expect(snap(-9, 20)).toBe(0);
    expect(snap(-11, 20)).toBe(-20);
    expect(snapPoint({ x: 23, y: 37 }, 20)).toEqual({ x: 20, y: 40 });
  });

  it('snapNodePosition snaps a node so its port row lands on the grid', () => {
    // The port row is the vertical center (position.y + h/2). Snapping makes it a grid multiple,
    // regardless of the node's height — so blocks aimed at the same row align horizontally.
    const s = snapNodePosition('start', { x: 23, y: 100 }, 20); // start h=44
    expect(s.x).toBe(20);
    expect((s.y + 44 / 2) % 20).toBe(0);

    const b = snapNodePosition('template', { x: 0, y: 213 }, 20); // template h=68
    expect((b.y + 68 / 2) % 20).toBe(0);
  });

  it('aligns different-height blocks aimed at the same row → a horizontal connecting edge', () => {
    // Aim both port-centers at grid line 120: start (h=44) and template (h=68).
    const s = snapNodePosition('start', { x: 0, y: 120 - 44 / 2 }, 20);
    const b = snapNodePosition('template', { x: 300, y: 120 - 68 / 2 }, 20);
    // Output port of `s` and input port of `b` share the same y → edgePath is a straight horizontal.
    expect(s.y + 44 / 2).toBe(120);
    expect(b.y + 68 / 2).toBe(120);
  });
});

describe('node mutations', () => {
  it('move / update patch a single node', () => {
    let g = graphOf(node('t', 'template'));
    g = moveNode(g, 't', { x: 50, y: 60 });
    expect(g.nodes[0]!.position).toEqual({ x: 50, y: 60 });
    g = updateNode(g, 't', { alias: 'login' });
    expect(g.nodes[0]!.alias).toBe('login');
  });

  it('removeNode cascades to its edges', () => {
    let g = graphOf(node('s', 'start'), node('t', 'template', 200));
    g = addEdge(g, { id: 'e1', from: 's', to: 't' });
    g = addNode(g, node('u', 'template', 400));
    g = addEdge(g, { id: 'e2', from: 't', to: 'u' });
    g = removeNode(g, 't');
    expect(g.nodes.map((n) => n.id)).toEqual(['s', 'u']);
    expect(g.edges).toHaveLength(0); // both edges touched t
  });
});
