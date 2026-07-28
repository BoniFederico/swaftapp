import {
  EMPTY_SCENARIO_GRAPH,
  SCENARIO_NODE_KINDS,
  type ScenarioBranch,
  type ScenarioEdge,
  type ScenarioGraph,
  type ScenarioNode,
  type ScenarioNodeKind,
} from './scenario';

/**
 * Codec between a Swaft {@link ScenarioGraph} and an **Arazzo 1.0** document (the OpenAPI Initiative's
 * standard for API workflows) — open-standards plan §7 / D6. A scenario becomes one `workflow` whose
 * `steps` are the graph's nodes; edges become `onSuccess`/`onFailure` `goto`s. Everything Arazzo has no
 * native concept for — non-HTTP nodes (action/capability/delay), decision diamonds, Seebo conditions,
 * canvas positions — is carried under **`x-swaft`** extensions, so the round-trip is lossless while the
 * document stays a valid Arazzo file another tool can partially read.
 *
 * Pure and tolerant: `fromArazzo` never throws (a malformed doc yields an empty graph).
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export interface ArazzoDocument {
  arazzo: string;
  info: { title: string; version: string };
  workflows: Obj[];
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workflow'
  );
}

/** Drop `undefined` values so the emitted `x-swaft` block stays minimal. */
function prune(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

function toStep(node: ScenarioNode, edges: ScenarioEdge[]): Obj {
  const out = edges.filter((e) => e.from === node.id);
  const step: Obj = { stepId: node.id };
  if (node.kind === 'template' && node.templateType === 'api' && node.ref) {
    step.operationId = node.ref; // best-effort native hint
  }
  step['x-swaft'] = prune({
    kind: node.kind,
    ref: node.ref,
    templateType: node.templateType,
    alias: node.alias,
    version: node.version,
    inputs: node.inputs,
    condition: node.condition,
    ms: node.ms,
    position: node.position,
    label: node.label,
  });
  if (node.kind === 'decision') {
    const t = out.find((e) => (e.branch ?? null) === 'true');
    const f = out.find((e) => (e.branch ?? null) === 'false');
    if (t) step.onSuccess = [{ name: 'true', type: 'goto', stepId: t.to }];
    if (f) step.onFailure = [{ name: 'false', type: 'goto', stepId: f.to }];
  } else {
    const e = out[0];
    if (e) step.onSuccess = [{ name: 'next', type: 'goto', stepId: e.to }];
  }
  return step;
}

/** Serialize a scenario graph to an Arazzo document. */
export function toArazzo(name: string, graph: ScenarioGraph): ArazzoDocument {
  const start = graph.nodes.find((n) => n.kind === 'start');
  const startEdge = start ? graph.edges.find((e) => e.from === start.id) : undefined;
  const steps = graph.nodes.filter((n) => n.kind !== 'start').map((n) => toStep(n, graph.edges));

  const workflow: Obj = {
    workflowId: slug(name),
    summary: name,
    steps,
    'x-swaft-version': graph.version,
    'x-swaft-start': start
      ? prune({ id: start.id, position: start.position, next: startEdge?.to })
      : null,
  };
  return {
    arazzo: '1.0.0',
    info: { title: name, version: '1.0.0' },
    workflows: [workflow],
  };
}

function asKind(v: unknown): ScenarioNodeKind {
  return (SCENARIO_NODE_KINDS as readonly string[]).includes(v as string)
    ? (v as ScenarioNodeKind)
    : 'template';
}

function edge(from: string, to: string, branch: ScenarioBranch | null): ScenarioEdge {
  const e: ScenarioEdge = { id: `e_${from}__${to}${branch ? `_${branch}` : ''}`, from, to };
  if (branch) e.branch = branch;
  return e;
}

function gotos(list: unknown): { stepId: string }[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((a): a is Obj => isObj(a) && a.type === 'goto' && typeof a.stepId === 'string')
    .map((a) => ({ stepId: a.stepId as string }));
}

/** Parse an Arazzo document back into a scenario graph. Tolerant: bad input → an empty graph. */
export function fromArazzo(doc: unknown): { name: string; graph: ScenarioGraph } {
  if (!isObj(doc)) return { name: 'Imported scenario', graph: EMPTY_SCENARIO_GRAPH };
  const info = isObj(doc.info) ? doc.info : {};
  const workflows = Array.isArray(doc.workflows) ? doc.workflows : [];
  const wf = isObj(workflows[0]) ? workflows[0] : {};
  const name = str(info.title) ?? str(wf.summary) ?? 'Imported scenario';

  const nodes: ScenarioNode[] = [];
  const edges: ScenarioEdge[] = [];

  const xstart = isObj(wf['x-swaft-start']) ? wf['x-swaft-start'] : undefined;
  const steps = Array.isArray(wf.steps) ? wf.steps : [];

  // Nothing to import (no entry, no steps) → an empty graph rather than a lone synthesized start.
  if (!xstart && steps.length === 0) return { name, graph: EMPTY_SCENARIO_GRAPH };

  const startId = (xstart && str(xstart.id)) || 'start';
  const startPos = xstart && isObj(xstart.position) ? xstart.position : { x: 80, y: 140 };
  nodes.push({ id: startId, kind: 'start', position: startPos as { x: number; y: number } });
  for (const s of steps) {
    if (!isObj(s)) continue;
    const x = isObj(s['x-swaft']) ? s['x-swaft'] : {};
    const id = str(s.stepId) ?? str(x.id);
    if (!id) continue;
    const kind = asKind(x.kind);
    const position = isObj(x.position) ? (x.position as { x: number; y: number }) : { x: 0, y: 0 };
    const node: ScenarioNode = { id, kind, position };
    if (str(x.ref) ?? str(s.operationId)) node.ref = str(x.ref) ?? str(s.operationId);
    if (str(x.templateType)) node.templateType = x.templateType as ScenarioNode['templateType'];
    if (str(x.alias)) node.alias = str(x.alias);
    if (str(x.version)) node.version = str(x.version);
    if (isObj(x.inputs)) node.inputs = x.inputs;
    if (str(x.condition)) node.condition = str(x.condition);
    if (typeof x.ms === 'number') node.ms = x.ms;
    if (str(x.label)) node.label = str(x.label);
    nodes.push(node);

    for (const g of gotos(s.onSuccess)) edges.push(edge(id, g.stepId, kind === 'decision' ? 'true' : null));
    for (const g of gotos(s.onFailure)) edges.push(edge(id, g.stepId, kind === 'decision' ? 'false' : null));
  }

  if (xstart && str(xstart.next)) edges.push(edge(startId, str(xstart.next)!, null));

  return { name, graph: { version: 1, nodes, edges } };
}
