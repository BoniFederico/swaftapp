import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ScenarioRunDto,
  ScenarioRunMode,
  ScenarioRunStatusResponse,
} from '@swaft/shared';
import type { ApiClient } from '../api-client/client';

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);
const POLL_MS = 400;

/** Per-node visual status for the canvas, derived from a run's recorded steps + the paused node. */
export type NodeRunStatus = 'succeeded' | 'failed' | 'branch-true' | 'branch-false' | 'awaiting';

export interface ScenarioRunController {
  /** The run currently being followed (live or a reopened past run), or null. */
  status: ScenarioRunStatusResponse | null;
  /** True while a live run is executing (running or awaiting input). */
  active: boolean;
  runs: ScenarioRunDto[];
  nodeStatus: Record<string, NodeRunStatus>;
  start: (opts: { startNodeId?: string; mode: ScenarioRunMode; authorizeActions: boolean }) => Promise<void>;
  stop: () => Promise<void>;
  provideInput: (values: Record<string, unknown>) => Promise<void>;
  view: (runId: string) => void;
  refreshRuns: () => void;
  clearRuns: () => Promise<void>;
}

/** Owns a scenario's run lifecycle: start/stop/provide-input, status polling, and the run history. */
export function useScenarioRun(client: ApiClient, scenarioId: string): ScenarioRunController {
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<ScenarioRunStatusResponse | null>(null);
  const [runs, setRuns] = useState<ScenarioRunDto[]>([]);

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

  const start = useCallback(
    async (opts: { startNodeId?: string; mode: ScenarioRunMode; authorizeActions: boolean }) => {
      const { runId: id } = await client.call('scenario.run', { id: scenarioId, ...opts });
      setStatus(null);
      setRunId(id);
    },
    [client, scenarioId],
  );

  const stop = useCallback(async () => {
    if (runId) await client.call('scenario.stop', { runId }).catch(() => undefined);
  }, [client, runId]);

  const provideInput = useCallback(
    async (values: Record<string, unknown>) => {
      if (runId) await client.call('scenario.provideInput', { runId, values }).catch(() => undefined);
    },
    [client, runId],
  );

  const view = useCallback((id: string) => {
    setStatus(null);
    setRunId(id);
  }, []);

  const clearRuns = useCallback(async () => {
    await client.call('scenario.runClear', { scenarioId }).catch(() => undefined);
    setRuns([]);
    setRunId(null);
    setStatus(null);
  }, [client, scenarioId]);

  const active = status != null && !TERMINAL.has(status.run.status);

  const nodeStatus = useMemo<Record<string, NodeRunStatus>>(() => {
    const map: Record<string, NodeRunStatus> = {};
    for (const step of status?.steps ?? []) {
      if (step.status === 'branch-true' || step.status === 'branch-false') map[step.nodeId] = step.status;
      else if (step.status === 'failed') map[step.nodeId] = 'failed';
      else map[step.nodeId] = 'succeeded';
    }
    if (status?.pending) map[status.pending.nodeId] = 'awaiting';
    return map;
  }, [status]);

  return { status, active, runs, nodeStatus, start, stop, provideInput, view, refreshRuns, clearRuns };
}
