import { describe, it, expect } from 'vitest';
import {
  EMPTY_SCENARIO_GRAPH,
  parseScenarioGraph,
  serializeScenarioGraph,
  type ScenarioGraph,
} from './scenario';

const VALID: ScenarioGraph = {
  version: 1,
  nodes: [
    { id: 'start', kind: 'start', position: { x: 0, y: 0 } },
    { id: 'n1', kind: 'template', ref: 't1', templateType: 'api', alias: 'login', position: { x: 10, y: 0 } },
    { id: 'd1', kind: 'decision', condition: "${ previous('login').status == 200 }", position: { x: 20, y: 0 } },
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'n1' },
    { id: 'e2', from: 'n1', to: 'd1' },
    { id: 'e3', from: 'd1', to: 'start', branch: 'true' },
  ],
};

describe('parseScenarioGraph', () => {
  it('round-trips a valid graph', () => {
    const { graph, ok } = parseScenarioGraph(serializeScenarioGraph(VALID));
    expect(ok).toBe(true);
    expect(graph).toEqual(VALID);
  });

  it('returns ok:false + empty graph on invalid JSON (never throws)', () => {
    const { graph, ok } = parseScenarioGraph('{ not json');
    expect(ok).toBe(false);
    expect(graph).toEqual(EMPTY_SCENARIO_GRAPH);
  });

  it('returns ok:false on a schema mismatch (wrong version / unknown key / bad node)', () => {
    expect(parseScenarioGraph(JSON.stringify({ version: 2, nodes: [], edges: [] })).ok).toBe(false);
    expect(parseScenarioGraph(JSON.stringify({ version: 1, nodes: [], edges: [], extra: 1 })).ok).toBe(false);
    expect(
      parseScenarioGraph(JSON.stringify({ version: 1, nodes: [{ id: 'x', kind: 'nope', position: { x: 0, y: 0 } }], edges: [] })).ok,
    ).toBe(false);
  });

  it('treats an empty graph as valid', () => {
    const { graph, ok } = parseScenarioGraph(serializeScenarioGraph(EMPTY_SCENARIO_GRAPH));
    expect(ok).toBe(true);
    expect(graph.nodes).toHaveLength(0);
  });
});
