import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ok, serializeScenarioGraph, type ScenarioGraph, type ResultEnvelope } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { ScenarioView } from './ScenarioView';

const GRAPH: ScenarioGraph = {
  version: 1,
  nodes: [{ id: 's1', kind: 'start', position: { x: 0, y: 0 } }],
  edges: [],
};

function scenarioTemplate(source: string) {
  return {
    id: 'sc1',
    folderId: null,
    projectId: 'p1',
    name: 'My Flow',
    type: 'scenario' as const,
    subtype: null,
    tagIds: [] as string[],
    method: null,
    source,
    hasDraft: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const COMPLETED_RUN = {
  id: 'r1',
  scenarioId: 'sc1',
  status: 'completed',
  mode: 'single',
  startNodeId: 's1',
  stepCount: 1,
  error: null,
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:01.000Z',
};
const RUN_STEP = {
  id: 'st1',
  runId: 'r1',
  seq: 0,
  nodeId: 'nX',
  alias: 'login',
  kind: 'api',
  status: 'succeeded',
  method: 'GET',
  url: 'https://example.com/login',
  httpStatus: 200,
  message: null,
  output: null,
  durationMs: 5,
  createdAt: '2026-01-01T00:00:00.500Z',
};

/** A fake transport: canned scenario ops; records every `scenario.run` payload for assertions. */
function makeTransport(runCalls: Record<string, unknown>[], seededRuns: unknown[] = []): Transport {
  let source = serializeScenarioGraph(GRAPH);
  return {
    call(op, payload): Promise<ResultEnvelope<unknown>> {
      const p = (payload ?? {}) as Record<string, unknown>;
      switch (op) {
        case 'template.get':
          return Promise.resolve(ok({ template: { ...scenarioTemplate(source), source } }));
        case 'release.list':
          return Promise.resolve(ok({ releases: [] }));
        case 'releaseSelection.get':
          return Promise.resolve(ok({ releaseId: 'draft' }));
        case 'tree.get':
          return Promise.resolve(ok({ tree: { projects: [], folders: [], templates: [], tags: [] } }));
        case 'template.updateSource':
          source = (p.source as string) ?? source;
          return Promise.resolve(ok({ template: { ...scenarioTemplate(source), source } }));
        case 'scenario.runList':
          return Promise.resolve(ok({ runs: seededRuns }));
        case 'scenario.run':
          runCalls.push(p);
          return Promise.resolve(ok({ runId: 'r1' }));
        case 'scenario.runStatus':
          return Promise.resolve(ok({ run: COMPLETED_RUN, steps: [RUN_STEP], pending: null }));
        default:
          return Promise.resolve(ok({}));
      }
    },
  };
}

function renderView(runCalls: Record<string, unknown>[], seededRuns: unknown[] = []) {
  return render(
    <AppProviders>
      <ScenarioView client={new ApiClient(makeTransport(runCalls, seededRuns))} templateId="sc1" />
    </AppProviders>,
  );
}

/**
 * Click Run once the graph has loaded. Before that the graph has no start node, so Run (a split
 * button that runs directly only with a single start) would open an empty menu instead.
 */
async function clickRun() {
  await waitFor(() => expect(document.querySelector('.scenario__canvas')?.textContent).toContain('Start'));
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
}

describe('ScenarioView toolbar', () => {
  it('renders the condensed Add menu, Run/Run batch controls, snap toggle and version listbox', async () => {
    renderView([]);
    await screen.findByRole('button', { name: 'Run' });
    // Add is a single condensed menu button (Start/Decision/Delay live inside it).
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add start' })).toBeNull();
    // Run batch has the same button shape as Run (single start → a plain button).
    expect(screen.getByRole('button', { name: 'Run batch' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Snap' })).toBeTruthy();
    expect(screen.getByText('Repeat')).toBeTruthy();
    // The version listbox defaults to Draft.
    const version = screen.getByRole('button', { name: 'Version' });
    expect(version.textContent).toContain('Draft');
  });

  it('runs the current in-memory graph — passing its source to scenario.run', async () => {
    const runCalls: Record<string, unknown>[] = [];
    renderView(runCalls);
    await clickRun();

    await waitFor(() => expect(runCalls.length).toBe(1));
    const call = runCalls[0]!;
    expect(call.id).toBe('sc1');
    // The current graph is sent verbatim as `source` (so unsaved edits run, not the stored version).
    expect(typeof call.source).toBe('string');
    expect(call.source as string).toContain('"kind": "start"');
  });

  it('keeps a run detail visible when its own history record is re-clicked', async () => {
    // Regression: clicking the record of the run already being followed (same id) used to clear the
    // detail. Run it, then click its history row (same id) — the steps must stay visible.
    localStorage.setItem('swaft:scenarioRunMin', 'off');
    const { container } = renderView([], [COMPLETED_RUN]);
    await clickRun();
    // The live run's step is shown.
    expect(await screen.findByText('login')).toBeTruthy();
    // Click the same run in the history (id === the followed run id).
    const row = await waitFor(() => {
      const el = container.querySelector('.scenario-run__run');
      if (!el) throw new Error('history row not rendered yet');
      return el as HTMLElement;
    });
    fireEvent.click(row);
    // Still there — the detail re-loaded instead of going blank.
    expect(await screen.findByText('login')).toBeTruthy();
    expect(screen.getByText('https://example.com/login')).toBeTruthy();
  });

  it('drops the followed run (detail + highlight) on a canvas click', async () => {
    localStorage.setItem('swaft:scenarioRunMin', 'off');
    const { container } = renderView([], [COMPLETED_RUN]);
    await clickRun();
    expect(await screen.findByText('login')).toBeTruthy();
    // A pointer-down anywhere on the canvas clears the (completed) run's focus.
    fireEvent.pointerDown(container.querySelector('.scenario__canvas')!);
    await waitFor(() => expect(screen.queryByText('login')).toBeNull());
  });
});

describe('ScenarioView keyboard shortcuts', () => {
  /** Render with a transport that counts saves; make the graph dirty by adding a delay node. */
  async function renderDirty() {
    const saves: unknown[] = [];
    const base = makeTransport([]);
    const transport: Transport = {
      call(op, payload) {
        if (op === 'template.updateSource') saves.push(payload);
        return base.call(op, payload);
      },
    };
    render(
      <AppProviders>
        <ScenarioView client={new ApiClient(transport)} templateId="sc1" />
      </AppProviders>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add delay' }));
    return saves;
  }

  it('ignores Ctrl+S while the scenario tab is hidden (another tab is active)', async () => {
    // jsdom has no layout: offsetParent is null, exactly like a mounted-but-hidden tab.
    const saves = await renderDirty();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(saves).toHaveLength(0);
  });

  it('saves on Ctrl+S when the scenario is the visible tab', async () => {
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    try {
      const saves = await renderDirty();
      fireEvent.keyDown(window, { key: 's', ctrlKey: true });
      await waitFor(() => expect(saves).toHaveLength(1));
    } finally {
      if (desc) Object.defineProperty(HTMLElement.prototype, 'offsetParent', desc);
    }
  });
});
