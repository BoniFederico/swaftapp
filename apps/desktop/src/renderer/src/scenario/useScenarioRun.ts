import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ScenarioBatchDto,
  ScenarioRunDto,
  ScenarioRunMode,
  ScenarioRunStatusResponse,
} from '@swaft/shared';
import type { ApiClient } from '../api-client/client';

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);
const POLL_MS = 400;

/** Per-node visual status for the canvas, derived from a run's recorded steps + the paused node. */
export type NodeRunStatus = 'succeeded' | 'failed' | 'branch-true' | 'branch-false' | 'awaiting' | 'paused';

export interface ScenarioRunController {
  /** The run currently being followed (live or a reopened past run), or null. */
  status: ScenarioRunStatusResponse | null;
  /** True while a live run is executing (running or awaiting input). */
  active: boolean;
  runs: ScenarioRunDto[];
  nodeStatus: Record<string, NodeRunStatus>;
  /** The batch currently running (or last finished), or null. */
  batch: ScenarioBatchDto | null;
  batchActive: boolean;
  start: (opts: {
    startNodeId?: string;
    onlyNode?: boolean;
    mode: ScenarioRunMode;
    authorizeActions: boolean;
    /** The current (possibly unsaved) graph source to run verbatim. */
    source?: string;
  }) => Promise<void>;
  startBatch: (opts: {
    count: number;
    interRunDelayMs: number;
    authorizeActions: boolean;
    startNodeId?: string;
    source?: string;
  }) => Promise<void>;
  stop: () => Promise<void>;
  stopBatch: () => Promise<void>;
  provideInput: (values: Record<string, unknown>, remember?: string[]) => Promise<void>;
  /** Resume a run paused at a breakpoint. */
  resume: () => Promise<void>;
  view: (runId: string) => void;
  /** Stop following the current run: clears the status + the per-node highlight + the history highlight. */
  clearFocus: () => void;
  refreshRuns: () => void;
  clearRuns: () => Promise<void>;
}

/** Owns a scenario's run lifecycle: start/stop/provide-input, status polling, and the run history. */
export function useScenarioRun(client: ApiClient, scenarioId: string): ScenarioRunController {
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<ScenarioRunStatusResponse | null>(null);
  const [runs, setRuns] = useState<ScenarioRunDto[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batch, setBatch] = useState<ScenarioBatchDto | null>(null);

  const refreshRuns = useCallback(() => {
    void client
      .call('scenario.runList', { scenarioId })
      .then((r) => setRuns(r.runs))
      .catch(() => setRuns([]));
  }, [client, scenarioId]);

  useEffect(() => refreshRuns(), [refreshRuns]);

  // Poll the followed run until it reaches a terminal state (or the id changes).
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const s = await client.call('scenario.runStatus', { runId });
        if (cancelled) return;
        setStatus(s);
        if (!TERMINAL.has(s.run.status)) timer = setTimeout(() => void tick(), POLL_MS);
        else refreshRuns();
      } catch {
        /* stop polling on error */
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [client, runId, refreshRuns]);

  // Poll a running batch; follow its current run so the canvas + steps track live, then refresh history.
  useEffect(() => {
    if (!batchId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const { batch: b } = await client.call('scenario.batchStatus', { batchId });
        if (cancelled) return;
        setBatch(b);
        if (b.currentRunId) setRunId(b.currentRunId);
        if (b.status === 'running') timer = setTimeout(() => void tick(), POLL_MS);
        else refreshRuns();
      } catch {
        /* stop polling on error */
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [client, batchId, refreshRuns]);

  const start = useCallback(
    async (opts: {
      startNodeId?: string;
      onlyNode?: boolean;
      mode: ScenarioRunMode;
      authorizeActions: boolean;
      source?: string;
    }) => {
      const { runId: id } = await client.call('scenario.run', { id: scenarioId, ...opts });
      setStatus(null);
      setRunId(id);
    },
    [client, scenarioId],
  );

  const startBatch = useCallback(
    async (opts: {
      count: number;
      interRunDelayMs: number;
      authorizeActions: boolean;
      startNodeId?: string;
      source?: string;
    }) => {
      const { batchId: id } = await client.call('scenario.runBatch', { id: scenarioId, ...opts });
      setBatch(null);
      setBatchId(id);
    },
    [client, scenarioId],
  );

  const stop = useCallback(async () => {
    if (runId) await client.call('scenario.stop', { runId }).catch(() => undefined);
  }, [client, runId]);

  const stopBatch = useCallback(async () => {
    if (batchId) await client.call('scenario.stopBatch', { batchId }).catch(() => undefined);
  }, [client, batchId]);

  const provideInput = useCallback(
    async (values: Record<string, unknown>, remember?: string[]) => {
      if (runId)
        await client
          .call('scenario.provideInput', { runId, values, remember })
          .catch(() => undefined);
    },
    [client, runId],
  );

  const resume = useCallback(async () => {
    if (runId) await client.call('scenario.resume', { runId }).catch(() => undefined);
  }, [client, runId]);

  const view = useCallback(
    (id: string) => {
      setRunId(id);
      // Fetch right away so re-selecting the run already being followed (same id → the polling effect
      // won't re-fire, and a terminal run isn't polling at all) still (re)shows its detail.
      void client
        .call('scenario.runStatus', { runId: id })
        .then((s) => setStatus(s))
        .catch(() => undefined);
    },
    [client],
  );

  const clearFocus = useCallback(() => {
    setRunId(null);
    setStatus(null);
  }, []);

  const clearRuns = useCallback(async () => {
    await client.call('scenario.runClear', { scenarioId }).catch(() => undefined);
    setRuns([]);
    setRunId(null);
    setStatus(null);
  }, [client, scenarioId]);

  const batchActive = batch != null && batch.status === 'running';
  const active = batchActive || (status != null && !TERMINAL.has(status.run.status));

  const nodeStatus = useMemo<Record<string, NodeRunStatus>>(() => {
    const map: Record<string, NodeRunStatus> = {};
    for (const step of status?.steps ?? []) {
      if (step.status === 'branch-true' || step.status === 'branch-false') map[step.nodeId] = step.status;
      else if (step.status === 'failed') map[step.nodeId] = 'failed';
      else map[step.nodeId] = 'succeeded';
    }
    if (status?.pending) map[status.pending.nodeId] = 'awaiting';
    if (status?.pausedAtNodeId) map[status.pausedAtNodeId] = 'paused';
    return map;
  }, [status]);

  return {
    status,
    active,
    runs,
    nodeStatus,
    batch,
    batchActive,
    start,
    startBatch,
    stop,
    stopBatch,
    provideInput,
    resume,
    view,
    clearFocus,
    refreshRuns,
    clearRuns,
  };
}
