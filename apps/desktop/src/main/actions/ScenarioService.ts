import { randomUUID } from 'node:crypto';
import {
  parseScenarioGraph,
  type BlockOutput,
  type HttpRequestModel,
  type RequirementDto,
  type ScenarioBatchDto,
  type ScenarioBatchStatus,
  type ScenarioGraph,
  type ScenarioNode,
  type ScenarioRunDto,
  type ScenarioRunMode,
  type ScenarioRunStatus,
  type ScenarioRunStatusResponse,
  type ScenarioRunStepDto,
} from '@swaft/shared';
import { AppError } from '../errors';
import { parseJsonOr } from '../util/json';
import type { SeeboHost, SeeboRenderContext } from '../seebo/SeeboHost';
import { RepoBase } from '../workspace/RepoBase';
import type { ApiRunService } from '../workspace/ApiRunService';
import type { ReleaseService } from '../workspace/ReleaseService';
import type { RenderService } from '../workspace/RenderService';
import type { TemplateService } from '../workspace/TemplateService';
import type { UserCodeRegistry } from '../usercode/UserCodeRegistry';
import type { WorkspaceService } from '../workspace/WorkspaceService';

/** Safety cap on how many nodes a single run may execute (bounds loops → guaranteed termination). */
const MAX_STEPS = 1000;
/** How long an output snapshot may be when stored for display (never bodies/inputs — redaction). */
const OUTPUT_SNAPSHOT_MAX = 4000;

export interface ScenarioServiceDeps {
  templates: TemplateService;
  releases: ReleaseService;
  render: RenderService;
  host: SeeboHost;
  apiRun: ApiRunService;
  userCode: UserCodeRegistry;
}

type ScenarioCtx = NonNullable<SeeboRenderContext['scenario']>;

/** One attempt at an attended block: it either succeeds, fails outright, or needs more input. */
type Attempt =
  | { kind: 'success'; output: BlockOutput }
  | { kind: 'pending'; requirements: RequirementDto[] }
  | { kind: 'error'; message: string };

/** In-memory state of a run in progress (the main process is long-lived, so runs live across ops). */
interface RunState {
  run: ScenarioRunDto;
  graph: ScenarioGraph;
  projectId: string | null;
  mode: ScenarioRunMode;
  authorizeActions: boolean;
  /** Run only the start node (a single block), without following its outgoing edges. */
  onlyNode: boolean;
  outputs: Record<string, BlockOutput>;
  previousAlias: string | null;
  cancelled: boolean;
  /** The inputs a paused (single-mode) block still needs. */
  pending: { nodeId: string; requirements: RequirementDto[] } | null;
  /** Node whose execution is being held by a breakpoint, while `run.status === 'paused-breakpoint'`. */
  pausedAtNodeId: string | null;
  /** Resolve the pause (input-required or breakpoint) with provided values, or 'cancelled' to abort. */
  resume: ((v: Record<string, unknown> | 'cancelled') => void) | null;
  /** Input values the user opted to reuse across the run, keyed by requirement id. */
  rememberedInputs: Record<string, unknown>;
}

interface RunRow {
  id: string;
  scenario_id: string;
  status: string;
  mode: string;
  start_node_id: string | null;
  step_count: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}
interface StepRow {
  id: string;
  run_id: string;
  seq: number;
  node_id: string;
  alias: string | null;
  kind: string;
  status: string;
  method: string | null;
  url: string | null;
  http_status: number | null;
  message: string | null;
  input: string | null;
  output: string | null;
  duration_ms: number | null;
  created_at: string;
}

/**
 * Runs a scenario workflow graph. One active path: non-decision nodes have a
 * single outgoing edge; a decision evaluates a boolean Seebo formula (with `previous(...)` bound to
 * prior block outputs) and takes the true/false branch. Blocks execute via the existing per-kind
 * services — API through {@link ApiRunService}, capability/action through {@link UserCodeRegistry} —
 * and each block's output envelope is stored so later blocks read it via `previous('alias')`.
 *
 * Attended (`single`) runs pause and ask for a block's missing inputs; unattended (`batch`) runs fail
 * the step. Actions run only when the run was started with a single `authorizeActions` acknowledgement
 * (the sandbox still forbids prod). Progress is polled from the local-only run tables; a run's calls
 * are logged on the scenario, not on the individual blocks.
 */
export class ScenarioService extends RepoBase {
  private readonly active = new Map<string, RunState>();
  private readonly batches = new Map<string, ScenarioBatchDto & { cancelled: boolean }>();

  constructor(
    ws: WorkspaceService,
    private readonly deps: ScenarioServiceDeps,
  ) {
    super(ws);
  }

  /** Start a run (in the background) and return its id immediately; poll status via {@link status}. */
  async run(req: {
    id: string;
    startNodeId?: string;
    onlyNode?: boolean;
    mode: ScenarioRunMode;
    authorizeActions: boolean;
    source?: string;
  }): Promise<{ runId: string }> {
    const { runId } = await this.startRun(req);
    return { runId };
  }

  /**
   * Create a run and begin executing it in the background. Returns its id plus a `done` promise that
   * resolves when the run reaches a terminal state — used by the batch loop to sequence runs.
   *
   * When `req.source` is provided, that graph is run verbatim (the currently-edited, possibly unsaved
   * version from the editor); otherwise the scenario's selected stored version is resolved.
   */
  private async startRun(req: {
    id: string;
    startNodeId?: string;
    onlyNode?: boolean;
    mode: ScenarioRunMode;
    authorizeActions: boolean;
    source?: string;
  }): Promise<{ runId: string; done: Promise<void> }> {
    const scenario = await this.deps.templates.requireTemplate(req.id);
    const source = req.source ?? (await this.deps.releases.resolveSource(req.id)).source;
    const { graph } = parseScenarioGraph(source);
    const startNodeId = req.startNodeId ?? graph.nodes.find((n) => n.kind === 'start')?.id ?? null;

    const runId = randomUUID();
    const now = this.ws.nowIso();
    const run: ScenarioRunDto = {
      id: runId,
      scenarioId: req.id,
      status: 'running',
      mode: req.mode,
      startNodeId,
      stepCount: 0,
      error: null,
      startedAt: now,
      finishedAt: null,
    };
    const state: RunState = {
      run,
      graph,
      projectId: scenario.projectId ?? (await this.deps.templates.projectIdOf(req.id)),
      mode: req.mode,
      authorizeActions: req.authorizeActions,
      onlyNode: req.onlyNode ?? false,
      outputs: {},
      previousAlias: null,
      cancelled: false,
      pending: null,
      pausedAtNodeId: null,
      resume: null,
      rememberedInputs: {},
    };
    this.active.set(runId, state);
    await this.insertRun(run);
    const done = this.loop(state).catch((e) => void this.finish(state, 'failed', errMsg(e)));
    return { runId, done };
  }

  /** Start a batch of `count` unattended runs, spaced by `interRunDelayMs`; poll via {@link batchStatus}. */
  async runBatch(req: {
    id: string;
    count: number;
    interRunDelayMs: number;
    authorizeActions: boolean;
    startNodeId?: string;
    source?: string;
  }): Promise<{ batchId: string }> {
    const batchId = randomUUID();
    const batch = {
      id: batchId,
      scenarioId: req.id,
      total: req.count,
      completed: 0,
      status: 'running' as ScenarioBatchStatus,
      currentRunId: null as string | null,
      cancelled: false,
    };
    this.batches.set(batchId, batch);
    void this.batchLoop(batch, req).catch(() => {
      batch.status = 'failed';
      batch.currentRunId = null;
    });
    return { batchId };
  }

  batchStatus(batchId: string): ScenarioBatchDto {
    const b = this.batches.get(batchId);
    if (!b) throw new AppError('SCENARIO_BATCH_NOT_FOUND', 'not_found', 'Batch not found.');
    const { cancelled, ...dto } = b;
    void cancelled;
    return dto;
  }

  /** Cancel a batch: stop the run in flight and end the loop after it settles. */
  async stopBatch(batchId: string): Promise<void> {
    const b = this.batches.get(batchId);
    if (!b) return;
    b.cancelled = true;
    if (b.currentRunId) await this.stop(b.currentRunId);
  }

  private async batchLoop(
    batch: ScenarioBatchDto & { cancelled: boolean },
    req: {
      id: string;
      count: number;
      interRunDelayMs: number;
      authorizeActions: boolean;
      startNodeId?: string;
      source?: string;
    },
  ): Promise<void> {
    for (let i = 0; i < req.count && !batch.cancelled; i++) {
      const { runId, done } = await this.startRun({
        id: req.id,
        startNodeId: req.startNodeId,
        mode: 'batch',
        authorizeActions: req.authorizeActions,
        source: req.source,
      });
      batch.currentRunId = runId;
      await done;
      batch.completed++;
      batch.currentRunId = null;
      if (i < req.count - 1 && !batch.cancelled && req.interRunDelayMs > 0) {
        await this.batchDelay(batch, req.interRunDelayMs);
      }
    }
    batch.status = batch.cancelled ? 'cancelled' : 'completed';
    batch.currentRunId = null;
  }

  private async batchDelay(batch: { cancelled: boolean }, ms: number): Promise<void> {
    const step = 100;
    let waited = 0;
    while (waited < ms && !batch.cancelled) {
      await new Promise((r) => setTimeout(r, Math.min(step, ms - waited)));
      waited += step;
    }
  }

  /** Current run status + its steps (+ the paused node's pending inputs, if any). */
  async status(runId: string): Promise<ScenarioRunStatusResponse> {
    const live = this.active.get(runId);
    const row = await this.adapter.get<RunRow>(`SELECT * FROM scenario_runs WHERE id = ?`, [runId]);
    if (!row && !live) throw new AppError('SCENARIO_RUN_NOT_FOUND', 'not_found', 'Run not found.');
    const run = live ? live.run : runFromRow(row!);
    const steps = (
      await this.adapter.all<StepRow>(
        `SELECT * FROM scenario_run_steps WHERE run_id = ? ORDER BY seq ASC`,
        [runId],
      )
    ).map(stepFromRow);
    return { run, steps, pending: live?.pending ?? null, pausedAtNodeId: live?.pausedAtNodeId ?? null };
  }

  /**
   * Provide the inputs a paused (single-mode) run was waiting on, so it continues. `remember` lists
   * requirement ids (among `values`) whose value should also auto-fill any later prompt with the same
   * id in this run — either another document template or an api block.
   */
  async provideInput(
    runId: string,
    values: Record<string, unknown>,
    remember?: string[],
  ): Promise<void> {
    const state = this.active.get(runId);
    if (!state) return;
    for (const id of remember ?? []) {
      if (Object.prototype.hasOwnProperty.call(values, id)) state.rememberedInputs[id] = values[id];
    }
    if (state.resume) state.resume(values);
  }

  /** Resume a run paused at a breakpoint (see {@link pauseForBreakpoint}). */
  async resume(runId: string): Promise<void> {
    const state = this.active.get(runId);
    if (state?.resume) state.resume({});
  }

  /** Request cancellation. Cooperative: the run stops before the next step (and unblocks a pause). */
  async stop(runId: string): Promise<void> {
    const state = this.active.get(runId);
    if (!state) return;
    state.cancelled = true;
    if (state.resume) state.resume('cancelled');
  }

  async list(scenarioId: string): Promise<ScenarioRunDto[]> {
    const rows = await this.adapter.all<RunRow>(
      `SELECT * FROM scenario_runs WHERE scenario_id = ? ORDER BY started_at DESC LIMIT 100`,
      [scenarioId],
    );
    return rows.map(runFromRow);
  }

  async clear(scenarioId: string): Promise<ScenarioRunDto[]> {
    await this.adapter.run(
      `DELETE FROM scenario_run_steps WHERE run_id IN (SELECT id FROM scenario_runs WHERE scenario_id = ?)`,
      [scenarioId],
    );
    await this.adapter.run(`DELETE FROM scenario_runs WHERE scenario_id = ?`, [scenarioId]);
    await this.ws.save();
    return [];
  }

  // --- the run loop ---------------------------------------------------------

  private async loop(state: RunState): Promise<void> {
    let node = state.run.startNodeId ? this.nodeById(state, state.run.startNodeId) : null;
    if (!node) {
      await this.finish(state, 'failed', 'No start node.');
      return;
    }
    let seq = 0;
    while (node && !state.cancelled && seq < MAX_STEPS) {
      const current: ScenarioNode = node;
      const ctx: ScenarioCtx = { outputs: state.outputs, previousAlias: state.previousAlias };

      if (current.kind === 'start') {
        await this.recordStep(state, seq, current, { kind: 'start', ok: true, output: null });
        node = this.nextNode(state, current);
      } else if (current.kind === 'delay') {
        await this.cancellableDelay(state, current.ms ?? 0);
        await this.recordStep(state, seq, current, { kind: 'delay', ok: true, output: null });
        node = this.nextNode(state, current);
      } else if (current.kind === 'decision') {
        const branch = await this.evalCondition(state, current.condition ?? '', ctx);
        await this.recordStep(state, seq, current, {
          kind: 'decision',
          ok: true,
          output: branch,
        });
        node = this.nextNode(state, current, branch ? 'true' : 'false');
      } else {
        if (current.breakpoint) {
          const held = await this.pauseForBreakpoint(state, current.id);
          if (held === 'cancelled') break;
        }
        const out = await this.execBlock(state, current, ctx);
        if (out === 'cancelled') break;
        const key = current.alias ?? current.id;
        state.outputs[key] = out;
        state.previousAlias = key;
        await this.recordStep(state, seq, current, out);
        if (!out.ok) {
          await this.finish(state, 'failed', out.error ?? 'A block failed.');
          return;
        }
        node = this.nextNode(state, current);
      }
      seq++;
      // A single-block run executes exactly the start node, then stops (no traversal).
      if (state.onlyNode) break;
    }
    if (state.cancelled) await this.finish(state, 'cancelled', null);
    else if (seq >= MAX_STEPS) await this.finish(state, 'failed', `Exceeded ${MAX_STEPS} steps.`);
    else await this.finish(state, 'completed', null);
  }

  /** Execute a template block, pausing (single) or failing (batch) when an input is missing. */
  private async execBlock(
    state: RunState,
    node: ScenarioNode,
    ctx: ScenarioCtx,
  ): Promise<BlockOutput | 'cancelled'> {
    const refId = node.ref;
    if (!refId) return failOutput('Block references no template.', node.templateType);
    const tpl = await this.deps.templates.getTemplate(refId).catch(() => null);
    const type = tpl?.type ?? node.templateType;
    if (!tpl) return failOutput('Referenced template not found.', type);

    let overrides: Record<string, unknown>;
    try {
      overrides = await this.renderInputs(state, node.inputs ?? {}, ctx);
    } catch (e) {
      return failOutput(errMsg(e), type);
    }

    if (type === 'api') {
      const { source } = await this.deps.releases.resolveSource(refId);
      const request = parseRequest(source);
      const initial = { ...(await this.deps.render.getInputState(refId)), ...overrides };
      return this.runAttempts(state, node, 'api', initial, async (values) => {
        try {
          const res = await this.deps.apiRun.send(refId, request, values, {
            scenario: ctx,
            skipHistory: true,
          });
          const json = parseJsonOr<unknown>(res.response.body, undefined);
          const sent = res.request ?? request;
          return {
            kind: 'success',
            output: {
              kind: 'api',
              ok: res.response.status < 400,
              output: json ?? res.response.body,
              method: sent.method,
              url: sent.url,
              status: res.response.status,
              statusText: res.response.statusText,
              headers: res.response.headers,
              input: JSON.stringify(values),
              body: res.response.body,
              json,
              durationMs: res.response.durationMs,
              error: res.response.status >= 400 ? `HTTP ${res.response.status}` : null,
            },
          };
        } catch (e) {
          const pending = inputRequired(e);
          return pending ? { kind: 'pending', requirements: pending } : { kind: 'error', message: errMsg(e) };
        }
      });
    }

    if (type === 'document') {
      const initial = { ...(await this.deps.render.getInputState(refId)), ...overrides };
      return this.runAttempts(state, node, 'document', initial, async (values) => {
        const result = await this.deps.render.render(refId, values, { scenario: ctx });
        if (result.status === 'failed') {
          const message = result.diagnostics.map((d) => d.message).join('; ') || 'Render failed.';
          return { kind: 'error', message };
        }
        if (result.status === 'completed') {
          return {
            kind: 'success',
            output: {
              kind: 'document',
              ok: true,
              output: result.output,
              error: null,
              jsonOutput: tpl.subtype === 'json',
            },
          };
        }
        return { kind: 'pending', requirements: result.pending };
      });
    }

    if (type === 'capability' || type === 'action') {
      if (type === 'action' && !state.authorizeActions) {
        return failOutput('Actions are not authorized for this run.', 'action');
      }
      try {
        const res = await this.deps.userCode.runOnce(refId, overrides);
        return {
          kind: type,
          ok: true,
          output: res.value,
          logs: res.logs,
          envWrites: res.envWrites,
          durationMs: res.durationMs,
          error: null,
        };
      } catch (e) {
        return failOutput(errMsg(e), type);
      }
    }

    return failOutput(`Unsupported block type "${type ?? 'unknown'}".`, type);
  }

  /** Render a node's input overrides (string values may be `${ … }` formulas) with the scenario ctx. */
  private async renderInputs(
    state: RunState,
    inputs: Record<string, unknown>,
    ctx: ScenarioCtx,
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(inputs)) {
      if (typeof v === 'string' && /[$#@]\{/.test(v)) {
        const state2 = await this.deps.host.render(v, {}, undefined, this.fullCtx(state, ctx));
        out[k] = state2.status === 'completed' ? (state2.output ?? '') : '';
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /** Render a decision's boolean condition; empty condition defaults to the true branch. */
  private async evalCondition(state: RunState, condition: string, ctx: ScenarioCtx): Promise<boolean> {
    if (!condition.trim()) return true;
    const rendered = await this.deps.host.render(condition, {}, undefined, this.fullCtx(state, ctx));
    if (rendered.status !== 'completed') return false;
    return String(rendered.output ?? '').trim() === 'true';
  }

  private fullCtx(state: RunState, scenario: ScenarioCtx): SeeboRenderContext {
    return { projectId: state.projectId, templateId: state.run.scenarioId, scenario };
  }

  private pauseForInput(
    state: RunState,
    nodeId: string,
    requirements: RequirementDto[],
  ): Promise<Record<string, unknown> | 'cancelled'> {
    state.pending = { nodeId, requirements };
    state.run.status = 'awaiting-input';
    void this.updateRunStatus(state);
    return new Promise((resolve) => {
      state.resume = (v) => {
        state.resume = null;
        state.pending = null;
        if (v !== 'cancelled') {
          state.run.status = 'running';
          void this.updateRunStatus(state);
        }
        resolve(v);
      };
    });
  }

  /**
   * Drive an attended block (api or document) to completion: run `attempt` with the current values;
   * on `pending`, fill what remembered inputs already resolve and retry, pause for the rest (fail
   * instead, in batch mode), then retry with the provided values. Shared by both block types so the
   * remember/pause loop is written once.
   */
  private async runAttempts(
    state: RunState,
    node: ScenarioNode,
    blockKind: 'api' | 'document',
    initialValues: Record<string, unknown>,
    attempt: (values: Record<string, unknown>) => Promise<Attempt>,
  ): Promise<BlockOutput | 'cancelled'> {
    let values = initialValues;
    for (;;) {
      const res = await attempt(values);
      if (res.kind === 'error') return failOutput(res.message, blockKind);
      if (res.kind === 'success') return res.output;
      const { filled, remaining } = this.applyRemembered(state, res.requirements);
      if (Object.keys(filled).length > 0) values = { ...values, ...filled };
      if (remaining.length === 0) continue;
      if (state.mode === 'batch') return failOutput('Missing inputs (unattended run).', blockKind);
      const provided = await this.pauseForInput(state, node.id, remaining);
      if (provided === 'cancelled') return 'cancelled';
      values = { ...values, ...provided };
    }
  }

  /** Split a block's pending requirements into ones a remembered value already resolves vs. not. */
  private applyRemembered(
    state: RunState,
    pending: RequirementDto[],
  ): { filled: Record<string, unknown>; remaining: RequirementDto[] } {
    const filled: Record<string, unknown> = {};
    const remaining: RequirementDto[] = [];
    for (const req of pending) {
      if (Object.prototype.hasOwnProperty.call(state.rememberedInputs, req.id)) {
        filled[req.id] = state.rememberedInputs[req.id];
      } else {
        remaining.push(req);
      }
    }
    return { filled, remaining };
  }

  /** Suspend the run right before executing a breakpointed block, until {@link resume} is called. */
  private pauseForBreakpoint(state: RunState, nodeId: string): Promise<'continue' | 'cancelled'> {
    state.pausedAtNodeId = nodeId;
    state.run.status = 'paused-breakpoint';
    void this.updateRunStatus(state);
    return new Promise((resolve) => {
      state.resume = (v) => {
        state.resume = null;
        state.pausedAtNodeId = null;
        if (v === 'cancelled') {
          resolve('cancelled');
          return;
        }
        state.run.status = 'running';
        void this.updateRunStatus(state);
        resolve('continue');
      };
    });
  }

  private async cancellableDelay(state: RunState, ms: number): Promise<void> {
    // Poll in short ticks so Stop interrupts a long delay promptly (no unref'd long timer left running).
    const step = 100;
    let waited = 0;
    while (waited < ms && !state.cancelled) {
      await new Promise((r) => setTimeout(r, Math.min(step, ms - waited)));
      waited += step;
    }
  }

  // --- graph walking --------------------------------------------------------

  private nodeById(state: RunState, id: string): ScenarioNode | null {
    return state.graph.nodes.find((n) => n.id === id) ?? null;
  }
  private nextNode(state: RunState, from: ScenarioNode, branch?: 'true' | 'false'): ScenarioNode | null {
    const edge = state.graph.edges.find(
      (e) => e.from === from.id && (branch ? e.branch === branch : true),
    );
    return edge ? this.nodeById(state, edge.to) : null;
  }

  // --- persistence ----------------------------------------------------------

  private async insertRun(run: ScenarioRunDto): Promise<void> {
    await this.adapter.run(
      `INSERT INTO scenario_runs (id, scenario_id, status, mode, start_node_id, step_count, error, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [run.id, run.scenarioId, run.status, run.mode, run.startNodeId, run.stepCount, run.error, run.startedAt, run.finishedAt],
    );
    await this.ws.save();
  }

  private async updateRunStatus(state: RunState): Promise<void> {
    const r = state.run;
    await this.adapter.run(
      `UPDATE scenario_runs SET status = ?, step_count = ?, error = ?, finished_at = ? WHERE id = ?`,
      [r.status, r.stepCount, r.error, r.finishedAt, r.id],
    );
    await this.ws.save();
  }

  private async recordStep(
    state: RunState,
    seq: number,
    node: ScenarioNode,
    out: BlockOutput,
  ): Promise<void> {
    const status =
      out.kind === 'decision'
        ? out.output === true
          ? 'branch-true'
          : 'branch-false'
        : out.ok
          ? 'succeeded'
          : 'failed';
    const isApi = out.kind === 'api';
    await this.adapter.run(
      `INSERT INTO scenario_run_steps (id, run_id, seq, node_id, alias, kind, status, method, url, http_status, message, input, output, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        state.run.id,
        seq,
        node.id,
        node.alias ?? null,
        out.kind,
        status,
        isApi ? (out.method ?? null) : null,
        isApi ? (out.url ?? null) : null,
        isApi ? (out.status ?? null) : null,
        out.error ?? null,
        isApi ? (out.input ?? null) : null,
        snapshotOutput(out),
        out.durationMs ?? null,
        this.ws.nowIso(),
      ],
    );
    state.run.stepCount = seq + 1;
    await this.updateRunStatus(state);
  }

  private async finish(state: RunState, status: ScenarioRunStatus, error: string | null): Promise<void> {
    state.run.status = status;
    state.run.error = error;
    state.run.finishedAt = this.ws.nowIso();
    state.pending = null;
    await this.updateRunStatus(state);
    // Keep the finished run out of the live map; the DB holds its final state for polling.
    this.active.delete(state.run.id);
  }
}

// --- helpers ----------------------------------------------------------------

function parseRequest(source: string): HttpRequestModel {
  try {
    const r = JSON.parse(source) as Partial<HttpRequestModel>;
    if (r && typeof r === 'object' && r.method && r.url !== undefined) {
      const model = { ...r } as HttpRequestModel;
      delete model.query;
      return model;
    }
  } catch {
    /* fall through */
  }
  return { method: 'GET', url: '' };
}

function failOutput(error: string, kind?: string): BlockOutput {
  return { kind: (kind as BlockOutput['kind']) ?? 'capability', ok: false, output: null, error };
}

/** True (with the pending requirements) when an error is a missing-input signal from the resolve step. */
function inputRequired(e: unknown): RequirementDto[] | null {
  if (e instanceof AppError && e.code === 'INPUT_REQUIRED') {
    const pending = e.details?.pending;
    return Array.isArray(pending) ? (pending as RequirementDto[]) : [];
  }
  return null;
}

function errMsg(e: unknown): string {
  return e instanceof AppError ? e.message : e instanceof Error ? e.message : String(e);
}

function snapshotOutput(out: BlockOutput): string | null {
  const value = out.output;
  if (value == null) return null;
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > OUTPUT_SNAPSHOT_MAX ? `${s.slice(0, OUTPUT_SNAPSHOT_MAX)}…` : s;
}

function runFromRow(r: RunRow): ScenarioRunDto {
  return {
    id: r.id,
    scenarioId: r.scenario_id,
    status: r.status as ScenarioRunStatus,
    mode: r.mode as ScenarioRunMode,
    startNodeId: r.start_node_id,
    stepCount: r.step_count,
    error: r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

function stepFromRow(r: StepRow): ScenarioRunStepDto {
  return {
    id: r.id,
    runId: r.run_id,
    seq: r.seq,
    nodeId: r.node_id,
    alias: r.alias,
    kind: r.kind,
    status: r.status,
    method: r.method,
    url: r.url,
    httpStatus: r.http_status,
    message: r.message,
    input: r.input,
    output: r.output,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
  };
}
