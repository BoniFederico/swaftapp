import { describe, it, expect } from 'vitest';
import {
  serializeScenarioGraph,
  type ScenarioGraph,
  type ScenarioRunStatusResponse,
} from '@swaft/shared';
import { AppError } from '../errors';
import { CryptoService } from '../crypto/CryptoService';
import { SeeboHost } from '../seebo/SeeboHost';
import { InProcessDbBackend } from '../storage/db-backend';
import { ChangelogService } from '../workspace/ChangelogService';
import { OrganizationService } from '../workspace/OrganizationService';
import { ReleaseService } from '../workspace/ReleaseService';
import { RenderService } from '../workspace/RenderService';
import { TemplateService } from '../workspace/TemplateService';
import { WorkspaceService, type WorkspaceFs } from '../workspace/WorkspaceService';
import type { ApiRunService } from '../workspace/ApiRunService';
import type { UserCodeRegistry } from '../usercode/UserCodeRegistry';
import { ScenarioService, redactInputs } from './ScenarioService';

/** A stub `apiRun` that returns a canned response per template id (or throws INPUT_REQUIRED once). */
function makeApiRunStub() {
  const calls: { templateId: string | undefined; scenario: unknown }[] = [];
  const bodies = new Map<string, string>();
  const failOnce = new Set<string>();
  const stub = {
    send: async (
      templateId: string | undefined,
      request: unknown,
      _values: Record<string, unknown>,
      opts: { scenario?: unknown } = {},
    ) => {
      calls.push({ templateId, scenario: opts.scenario });
      if (templateId && failOnce.has(templateId)) {
        failOnce.delete(templateId);
        throw new AppError('INPUT_REQUIRED', 'validation', 'Fill inputs', {
          pending: [{ id: 'x', capability: 'textbox', label: null, options: null, type: null }],
        });
      }
      const body = (templateId && bodies.get(templateId)) || '{"ok":true}';
      return {
        response: { status: 200, statusText: 'OK', headers: {}, body, durationMs: 1 },
        rendered: false,
        request: request as never,
      };
    },
  };
  return { stub: stub as unknown as ApiRunService, calls, bodies, failOnce };
}

const userCodeStub = {
  runOnce: async (_id: string, args: Record<string, unknown>) => ({
    value: { echoed: args },
    durationMs: 1,
    logs: [] as string[],
    envWrites: [] as string[],
  }),
} as unknown as UserCodeRegistry;

async function setup() {
  const files = new Map<string, Uint8Array>();
  const fs: WorkspaceFs = {
    read: (p) => Promise.resolve(files.get(p) ?? null),
    write: (p, b) => {
      files.set(p, b);
      return Promise.resolve();
    },
  };
  const ws = new WorkspaceService({
    createBackend: (bytes) => InProcessDbBackend.open(bytes),
    crypto: new CryptoService(),
    fs,
    deviceId: () => 'dev-1',
  });
  await ws.create({ name: 'WS', location: 'mem://sc.swaft', encrypt: false });

  const org = new OrganizationService(ws);
  const changelog = new ChangelogService(ws);
  const templates = new TemplateService(ws, org, changelog);
  const releases = new ReleaseService(ws, templates, changelog);
  const host = new SeeboHost();
  const render = new RenderService(ws, templates, host, releases);

  let tree = await org.createProject({ name: 'P' });
  tree = await org.createFolder({ name: 'F', projectId: tree.projects[0]!.id });
  const folderId = tree.folders[0]!.id;

  const api = makeApiRunStub();
  const scenario = new ScenarioService(ws, {
    templates,
    releases,
    render,
    host,
    apiRun: api.stub,
    userCode: userCodeStub,
  });

  async function newTemplate(name: string, type: 'api' | 'action' | 'capability' | 'scenario', source = 'x') {
    const t = await templates.createTemplate({ folderId, name, source, type });
    return t.templates.find((x) => x.name === name)!.id;
  }
  async function newScenario(name: string, graph: ScenarioGraph) {
    return newTemplate(name, 'scenario', serializeScenarioGraph(graph));
  }
  async function waitFor(runId: string, pred: (s: ScenarioRunStatusResponse) => boolean) {
    const start = Date.now();
    while (Date.now() - start < 3000) {
      const s = await scenario.status(runId);
      if (pred(s)) return s;
      await new Promise((r) => setTimeout(r, 8));
    }
    throw new Error('waitFor timed out');
  }

  return { scenario, newTemplate, newScenario, waitFor, api, ws };
}

const at = (x: number) => ({ x, y: 0 });

describe('ScenarioService runner', () => {
  it('runs a path, flows previous() into a decision, and takes the true branch', async () => {
    const { scenario, newTemplate, newScenario, waitFor } = await setup();
    const a = await newTemplate('A', 'api');
    const yes = await newTemplate('Yes', 'api');
    const no = await newTemplate('No', 'api');
    const graph: ScenarioGraph = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', position: at(0) },
        { id: 'na', kind: 'template', ref: a, templateType: 'api', alias: 'a', position: at(1) },
        { id: 'nd', kind: 'decision', condition: "${ previous('a').status == 200 }", position: at(2) },
        { id: 'ny', kind: 'template', ref: yes, templateType: 'api', alias: 'yes', position: at(3) },
        { id: 'nn', kind: 'template', ref: no, templateType: 'api', alias: 'no', position: at(4) },
      ],
      edges: [
        { id: 'e0', from: 'start', to: 'na' },
        { id: 'e1', from: 'na', to: 'nd' },
        { id: 'e2', from: 'nd', to: 'ny', branch: 'true' },
        { id: 'e3', from: 'nd', to: 'nn', branch: 'false' },
      ],
    };
    const sid = await newScenario('Flow', graph);

    const { runId } = await scenario.run({ id: sid, mode: 'single', authorizeActions: false });
    const done = await waitFor(runId, (s) => s.run.status === 'completed');

    const kinds = done.steps.map((st) => `${st.kind}:${st.status}`);
    expect(kinds).toContain('decision:branch-true');
    // The true branch ran; the false branch did not.
    expect(done.steps.some((st) => st.alias === 'yes')).toBe(true);
    expect(done.steps.some((st) => st.alias === 'no')).toBe(false);
  });

  it('pauses for missing inputs (single) then continues once provided', async () => {
    const { scenario, newTemplate, newScenario, waitFor, api } = await setup();
    const a = await newTemplate('A', 'api');
    api.failOnce.add(a); // first send throws INPUT_REQUIRED
    const graph: ScenarioGraph = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', position: at(0) },
        { id: 'na', kind: 'template', ref: a, templateType: 'api', alias: 'a', position: at(1) },
      ],
      edges: [{ id: 'e0', from: 'start', to: 'na' }],
    };
    const sid = await newScenario('Flow', graph);

    const { runId } = await scenario.run({ id: sid, mode: 'single', authorizeActions: false });
    const paused = await waitFor(runId, (s) => s.run.status === 'awaiting-input');
    expect(paused.pending?.nodeId).toBe('na');
    expect(paused.pending?.requirements[0]?.id).toBe('x');

    await scenario.provideInput(runId, { x: 'value' });
    await waitFor(runId, (s) => s.run.status === 'completed');
  });

  it('fails the step on missing inputs in a batch (unattended) run', async () => {
    const { scenario, newTemplate, newScenario, waitFor, api } = await setup();
    const a = await newTemplate('A', 'api');
    api.failOnce.add(a);
    const graph: ScenarioGraph = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', position: at(0) },
        { id: 'na', kind: 'template', ref: a, templateType: 'api', alias: 'a', position: at(1) },
      ],
      edges: [{ id: 'e0', from: 'start', to: 'na' }],
    };
    const sid = await newScenario('Flow', graph);

    const { runId } = await scenario.run({ id: sid, mode: 'batch', authorizeActions: false });
    const done = await waitFor(runId, (s) => s.run.status === 'failed');
    expect(done.steps.find((st) => st.nodeId === 'na')?.status).toBe('failed');
  });

  it('refuses action blocks unless the run authorized actions', async () => {
    const { scenario, newTemplate, newScenario, waitFor } = await setup();
    const act = await newTemplate('Act', 'action');
    const graph: ScenarioGraph = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', position: at(0) },
        { id: 'nx', kind: 'template', ref: act, templateType: 'action', alias: 'x', position: at(1) },
      ],
      edges: [{ id: 'e0', from: 'start', to: 'nx' }],
    };
    const sid = await newScenario('Flow', graph);

    const { runId } = await scenario.run({ id: sid, mode: 'batch', authorizeActions: false });
    const done = await waitFor(runId, (s) => s.run.status === 'failed');
    expect(done.steps.find((st) => st.nodeId === 'nx')?.status).toBe('failed');

    // With authorization the action block runs and the scenario completes.
    const r2 = await scenario.run({ id: sid, mode: 'batch', authorizeActions: true });
    await waitFor(r2.runId, (s) => s.run.status === 'completed');
  });

  it('runs a batch of N runs back to back and reports progress', async () => {
    const { scenario, newTemplate, newScenario, waitFor } = await setup();
    void waitFor;
    const a = await newTemplate('A', 'api');
    const graph: ScenarioGraph = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', position: at(0) },
        { id: 'na', kind: 'template', ref: a, templateType: 'api', alias: 'a', position: at(1) },
      ],
      edges: [{ id: 'e0', from: 'start', to: 'na' }],
    };
    const sid = await newScenario('Flow', graph);

    const { batchId } = await scenario.runBatch({ id: sid, count: 3, interRunDelayMs: 0, authorizeActions: false });
    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (scenario.batchStatus(batchId).status === 'completed') break;
      await new Promise((r) => setTimeout(r, 8));
    }
    const b = scenario.batchStatus(batchId);
    expect(b.status).toBe('completed');
    expect(b.total).toBe(3);
    expect(b.completed).toBe(3);
    // The 3 runs are all in the scenario's history.
    expect((await scenario.list(sid)).length).toBe(3);
  });

  it('runs a batch starting from a chosen node (skipping earlier ones)', async () => {
    const { scenario, newTemplate, newScenario } = await setup();
    const a = await newTemplate('A', 'api');
    const b = await newTemplate('B', 'api');
    const graph: ScenarioGraph = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', position: at(0) },
        { id: 'na', kind: 'template', ref: a, templateType: 'api', alias: 'a', position: at(1) },
        { id: 'nb', kind: 'template', ref: b, templateType: 'api', alias: 'b', position: at(2) },
      ],
      edges: [
        { id: 'e0', from: 'start', to: 'na' },
        { id: 'e1', from: 'na', to: 'nb' },
      ],
    };
    const sid = await newScenario('Flow', graph);

    const { batchId } = await scenario.runBatch({
      id: sid,
      count: 1,
      interRunDelayMs: 0,
      authorizeActions: false,
      startNodeId: 'nb',
    });
    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (scenario.batchStatus(batchId).status === 'completed') break;
      await new Promise((r) => setTimeout(r, 8));
    }
    const runs = await scenario.list(sid);
    expect(runs.length).toBe(1);
    const status = await scenario.status(runs[0]!.id);
    // Started at 'nb' → only 'b' ran; 'a' was skipped.
    expect(status.steps.map((st) => st.alias)).toEqual(['b']);
  });

  it('stops a batch after the current run', async () => {
    const { scenario, newScenario } = await setup();
    const graph: ScenarioGraph = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', position: at(0) },
        { id: 'nd', kind: 'delay', ms: 3000, position: at(1) },
      ],
      edges: [{ id: 'e0', from: 'start', to: 'nd' }],
    };
    const sid = await newScenario('Flow', graph);
    const { batchId } = await scenario.runBatch({ id: sid, count: 100, interRunDelayMs: 0, authorizeActions: false });
    // Let the first run start, then cancel.
    await new Promise((r) => setTimeout(r, 30));
    await scenario.stopBatch(batchId);
    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (scenario.batchStatus(batchId).status === 'cancelled') break;
      await new Promise((r) => setTimeout(r, 8));
    }
    expect(scenario.batchStatus(batchId).status).toBe('cancelled');
    expect(scenario.batchStatus(batchId).completed).toBeLessThan(100);
  });

  it('pauses a single run at a breakpoint and continues on resume', async () => {
    const { scenario, newTemplate, newScenario, waitFor, api } = await setup();
    const a = await newTemplate('A', 'api');
    const graph: ScenarioGraph = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', position: at(0) },
        { id: 'na', kind: 'template', ref: a, templateType: 'api', alias: 'a', breakpoint: true, position: at(1) },
      ],
      edges: [{ id: 'e0', from: 'start', to: 'na' }],
    };
    const sid = await newScenario('Flow', graph);
    const { runId } = await scenario.run({ id: sid, mode: 'single', authorizeActions: false });
    const paused = await waitFor(runId, (s) => s.run.status === 'paused-breakpoint');
    expect(paused.pausedAtNodeId).toBe('na');
    expect(api.calls.length).toBe(0);
    await scenario.resume(runId);
    const done = await waitFor(runId, (s) => s.run.status === 'completed');
    expect(done.steps.map((st) => st.alias)).toEqual([null, 'a']);
    expect(api.calls.length).toBe(1);
  });

  it('ignores breakpoints in unattended batch runs', async () => {
    const { scenario, newTemplate, newScenario } = await setup();
    const a = await newTemplate('A', 'api');
    const graph: ScenarioGraph = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', position: at(0) },
        { id: 'na', kind: 'template', ref: a, templateType: 'api', alias: 'a', breakpoint: true, position: at(1) },
      ],
      edges: [{ id: 'e0', from: 'start', to: 'na' }],
    };
    const sid = await newScenario('Flow', graph);
    const { batchId } = await scenario.runBatch({ id: sid, count: 2, interRunDelayMs: 0, authorizeActions: false });
    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (scenario.batchStatus(batchId).status === 'completed') break;
      await new Promise((r) => setTimeout(r, 8));
    }
    expect(scenario.batchStatus(batchId)).toMatchObject({ status: 'completed', completed: 2 });
  });

  it('stops a run (and its batch) when the workspace is closed mid-run', async () => {
    const { scenario, newScenario, ws } = await setup();
    const graph: ScenarioGraph = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', position: at(0) },
        { id: 'nd', kind: 'delay', ms: 200, position: at(1) },
      ],
      edges: [{ id: 'e0', from: 'start', to: 'nd' }],
    };
    const sid = await newScenario('Flow', graph);
    const { batchId } = await scenario.runBatch({ id: sid, count: 5, interRunDelayMs: 0, authorizeActions: false });
    await new Promise((r) => setTimeout(r, 30));
    await ws.close();
    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (scenario.batchStatus(batchId).status !== 'running') break;
      await new Promise((r) => setTimeout(r, 8));
    }
    // The batch ends instead of hanging or starting runs in no / another workspace.
    expect(scenario.batchStatus(batchId).status).toBe('cancelled');
    expect(scenario.batchStatus(batchId).completed).toBeLessThan(5);
  });

  it('never executes the held block when a paused run is resumed after a workspace switch', async () => {
    const { scenario, newTemplate, newScenario, waitFor, api, ws } = await setup();
    const a = await newTemplate('A', 'api');
    const graph: ScenarioGraph = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', position: at(0) },
        { id: 'na', kind: 'template', ref: a, templateType: 'api', alias: 'a', breakpoint: true, position: at(1) },
      ],
      edges: [{ id: 'e0', from: 'start', to: 'na' }],
    };
    const sid = await newScenario('Flow', graph);
    const { runId } = await scenario.run({ id: sid, mode: 'single', authorizeActions: false });
    await waitFor(runId, (s) => s.run.status === 'paused-breakpoint');
    await ws.create({ name: 'Other', location: 'mem://other.swaft', encrypt: false });
    await scenario.resume(runId);
    await new Promise((r) => setTimeout(r, 50));
    expect(api.calls.length).toBe(0);
  });

  it('masks credential-looking inputs in stored step history', () => {
    expect(
      redactInputs({
        user: 'bob',
        password: 'hunter2',
        apiKey: 'k',
        api_key: 'k',
        accessToken: 't',
        'client-secret': 's',
        token: '',
        author: 'Ada',
        passenger: 'Bob',
        q: 1,
      }),
    ).toEqual({
      user: 'bob',
      password: '•••',
      apiKey: '•••',
      api_key: '•••',
      accessToken: '•••',
      'client-secret': '•••',
      token: '',
      author: 'Ada',
      passenger: 'Bob',
      q: 1,
    });
  });

  it('runs the current in-memory source override, not the stored version', async () => {
    const { scenario, newTemplate, newScenario, waitFor } = await setup();
    const a = await newTemplate('A', 'api');
    // Stored graph: just a start node (a normal run would execute nothing else).
    const stored: ScenarioGraph = {
      version: 1,
      nodes: [{ id: 'start', kind: 'start', position: at(0) }],
      edges: [],
    };
    const sid = await newScenario('Flow', stored);
    // The edited (unsaved) graph adds an API block after the start.
    const edited: ScenarioGraph = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', position: at(0) },
        { id: 'na', kind: 'template', ref: a, templateType: 'api', alias: 'a', position: at(1) },
      ],
      edges: [{ id: 'e0', from: 'start', to: 'na' }],
    };

    const { runId } = await scenario.run({
      id: sid,
      mode: 'single',
      authorizeActions: false,
      source: serializeScenarioGraph(edited),
    });
    const done = await waitFor(runId, (s) => s.run.status === 'completed');
    // The override graph ran: the API block executed even though it is not in the stored source.
    expect(done.steps.some((st) => st.alias === 'a')).toBe(true);
  });

  it('runs a single block only (onlyNode) without following its edges', async () => {
    const { scenario, newTemplate, newScenario, waitFor } = await setup();
    const a = await newTemplate('A', 'api');
    const b = await newTemplate('B', 'api');
    const graph: ScenarioGraph = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', position: at(0) },
        { id: 'na', kind: 'template', ref: a, templateType: 'api', alias: 'a', position: at(1) },
        { id: 'nb', kind: 'template', ref: b, templateType: 'api', alias: 'b', position: at(2) },
      ],
      edges: [
        { id: 'e0', from: 'start', to: 'na' },
        { id: 'e1', from: 'na', to: 'nb' },
      ],
    };
    const sid = await newScenario('Flow', graph);

    const { runId } = await scenario.run({
      id: sid,
      startNodeId: 'na',
      onlyNode: true,
      mode: 'single',
      authorizeActions: false,
    });
    const done = await waitFor(runId, (s) => s.run.status === 'completed');
    expect(done.steps.map((st) => st.alias)).toEqual(['a']);
    expect(done.steps.some((st) => st.alias === 'b')).toBe(false);
  });

  it('stops a run cooperatively while it waits on a delay', async () => {
    const { scenario, newScenario, waitFor } = await setup();
    const graph: ScenarioGraph = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', position: at(0) },
        { id: 'nd', kind: 'delay', ms: 5000, position: at(1) },
      ],
      edges: [{ id: 'e0', from: 'start', to: 'nd' }],
    };
    const sid = await newScenario('Flow', graph);
    const { runId } = await scenario.run({ id: sid, mode: 'batch', authorizeActions: false });
    await waitFor(runId, (s) => s.run.status === 'running');
    await scenario.stop(runId);
    await waitFor(runId, (s) => s.run.status === 'cancelled');
  });
});
