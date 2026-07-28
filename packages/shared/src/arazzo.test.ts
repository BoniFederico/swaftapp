import { describe, expect, it } from 'vitest';
import { fromArazzo, toArazzo } from './arazzo';
import type { ScenarioGraph } from './scenario';

const graph: ScenarioGraph = {
  version: 1,
  nodes: [
    { id: 'start', kind: 'start', position: { x: 80, y: 140 } },
    {
      id: 'n1',
      kind: 'template',
      templateType: 'api',
      ref: 'login-req',
      alias: 'login',
      version: 'draft',
      position: { x: 240, y: 140 },
    },
    {
      id: 'n2',
      kind: 'decision',
      condition: "${ previous('login').status == 200 }",
      position: { x: 460, y: 140 },
    },
    { id: 'n3', kind: 'delay', ms: 2000, position: { x: 680, y: 80 } },
    { id: 'n4', kind: 'template', templateType: 'action', ref: 'notify', position: { x: 680, y: 220 } },
  ],
  edges: [
    { id: 'e0', from: 'start', to: 'n1' },
    { id: 'e1', from: 'n1', to: 'n2' },
    { id: 'e2', from: 'n2', to: 'n3', branch: 'true' },
    { id: 'e3', from: 'n2', to: 'n4', branch: 'false' },
  ],
};

describe('toArazzo', () => {
  it('emits a valid-looking Arazzo document with one workflow and a step per non-start node', () => {
    const doc = toArazzo('Login flow', graph);
    expect(doc.arazzo).toBe('1.0.0');
    expect(doc.info.title).toBe('Login flow');
    const wf = doc.workflows[0];
    expect(wf.workflowId).toBe('login-flow');
    expect((wf.steps as unknown[]).length).toBe(4);
  });

  it('maps an api node to a native operationId hint and keeps fidelity under x-swaft', () => {
    const wf = toArazzo('f', graph).workflows[0];
    const step = (wf.steps as Record<string, unknown>[]).find((s) => s.stepId === 'n1')!;
    expect(step.operationId).toBe('login-req');
    expect((step['x-swaft'] as Record<string, unknown>).alias).toBe('login');
    expect((step['x-swaft'] as Record<string, unknown>).kind).toBe('template');
  });

  it('maps a decision to onSuccess(true)/onFailure(false) gotos', () => {
    const wf = toArazzo('f', graph).workflows[0];
    const dec = (wf.steps as Record<string, unknown>[]).find((s) => s.stepId === 'n2')!;
    expect((dec.onSuccess as { stepId: string }[])[0].stepId).toBe('n3');
    expect((dec.onFailure as { stepId: string }[])[0].stepId).toBe('n4');
  });
});

describe('fromArazzo', () => {
  it('round-trips the graph (nodes + edges + branches)', () => {
    const back = fromArazzo(toArazzo('Login flow', graph)).graph;

    // same node ids and kinds
    const kindById = (g: ScenarioGraph) => Object.fromEntries(g.nodes.map((n) => [n.id, n.kind]));
    expect(kindById(back)).toEqual(kindById(graph));

    // node fidelity
    const n1 = back.nodes.find((n) => n.id === 'n1')!;
    expect(n1).toMatchObject({ templateType: 'api', ref: 'login-req', alias: 'login', version: 'draft' });
    expect(back.nodes.find((n) => n.id === 'n2')!.condition).toBe("${ previous('login').status == 200 }");
    expect(back.nodes.find((n) => n.id === 'n3')!.ms).toBe(2000);

    // edges: same (from,to,branch) set, ignoring generated ids
    const key = (g: ScenarioGraph) =>
      g.edges.map((e) => `${e.from}->${e.to}:${e.branch ?? ''}`).sort();
    expect(key(back)).toEqual(key(graph));
  });

  it('preserves canvas positions', () => {
    const back = fromArazzo(toArazzo('f', graph)).graph;
    expect(back.nodes.find((n) => n.id === 'n3')!.position).toEqual({ x: 680, y: 80 });
    expect(back.nodes.find((n) => n.id === 'start')!.position).toEqual({ x: 80, y: 140 });
  });

  it('is tolerant of a malformed document', () => {
    expect(fromArazzo(null).graph.nodes).toEqual([]);
    expect(fromArazzo({ workflows: 'nope' }).graph.nodes).toEqual([]);
  });
});
