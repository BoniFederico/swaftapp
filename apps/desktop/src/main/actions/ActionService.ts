import { randomUUID } from 'node:crypto';
import type { ReceiptDto } from '@swaft/shared';
import type { SeeboHost } from '../seebo/SeeboHost';
import type { SeeboActionReceipt } from '../seebo/seebo-module';
import { RepoBase } from '../workspace/RepoBase';
import type { ReleaseService } from '../workspace/ReleaseService';
import type { RenderService } from '../workspace/RenderService';
import type { SettingsService } from '../workspace/SettingsService';
import type { WorkspaceService } from '../workspace/WorkspaceService';

interface ReceiptRow {
  id: string;
  action_id: string;
  action_type: string;
  status: string;
  message: string;
  environment: string;
  created_at: string;
}

export interface ActionServiceDeps {
  host: SeeboHost;
  releases: ReleaseService;
  render: RenderService;
  settings: SettingsService;
  currentUsername: () => string | null;
}

/**
 * Executes a template's prepared action plan by bridging to Seebo's `seebo/actions` layer (the pure
 * core only prepares plans; this host layer executes — see docs/seebo/ACTIONS.md). It re-renders the
 * template server-side to obtain the authoritative plan (never trusting a renderer-supplied one),
 * then `executeActionPlan` enforces confirmation/permissions/policy fail-closed. The sandbox (active
 * unless developer mode) forbids `prod`. Receipts are **redacted** and persisted **local-only** (🔵).
 */
export class ActionService extends RepoBase {
  constructor(
    ws: WorkspaceService,
    private readonly deps: ActionServiceDeps,
  ) {
    super(ws);
  }

  async execute(
    templateId: string,
    opts: { confirmedActions: string[]; failFast: boolean; dryRun?: boolean },
  ): Promise<ReceiptDto[]> {
    const { source } = await this.deps.releases.resolveSource(templateId);
    const values = await this.deps.render.getInputState(templateId);
    const state = await this.deps.host.render(source, values);
    const plan = state.actions ?? [];
    if (plan.length === 0) return this.list(templateId);

    const settings = await this.deps.settings.getSettings();
    const sandbox = settings.executionMode !== 'dev';
    const result = await this.deps.host.executeActions(plan, {
      confirmedActions: opts.confirmedActions,
      failFast: opts.failFast,
      dryRun: opts.dryRun ?? false,
      permissions: [], // no actor-permission model yet; permissioned actions are skipped
      environment: 'test',
      actor: { username: this.deps.currentUsername() ?? 'unknown' },
      // Sandbox forbids prod; the per-type gate is the set of registered action handlers.
      policy: sandbox ? { allowedEnvironments: ['test', 'preprod'] } : {},
      // Input may carry rendered secrets (a formula reading env), so it stays redacted; output is
      // what the author's own action chose to return, and the user asked to see it — pass it through.
      redact: (value, ctx) => (ctx.field === 'output' ? value : '[redacted]'),
    });

    // Enrich the receipts for the run that just happened with their detail, keyed by the id we
    // persist under. Only these carry output/logs; the historical list stays a redacted audit trail.
    const detail = new Map<string, Pick<ReceiptDto, 'output' | 'logs' | 'envWrites'>>();
    for (const receipt of result.receipts) {
      const id = randomUUID();
      await this.persist(id, templateId, receipt);
      detail.set(id, detailOf(receipt.output));
    }
    await this.ws.save();
    const all = await this.list(templateId);
    return all.map((dto) => (detail.has(dto.id) ? { ...dto, ...detail.get(dto.id) } : dto));
  }

  async list(templateId: string): Promise<ReceiptDto[]> {
    const rows = await this.adapter.all<ReceiptRow>(
      `SELECT id, action_id, action_type, status, message, environment, created_at
       FROM receipts WHERE template_id = ? ORDER BY created_at DESC LIMIT 100`,
      [templateId],
    );
    return rows.map((r) => ({
      id: r.id,
      actionId: r.action_id,
      actionType: r.action_type,
      status: r.status,
      message: r.message,
      environment: r.environment,
      createdAt: r.created_at,
    }));
  }

  private async persist(id: string, templateId: string, r: SeeboActionReceipt): Promise<void> {
    // Redacted at rest: store status + an error code/message only — never the action's values. The
    // fresh detail is returned in the response instead, so a reopened document shows the audit line.
    const message = (
      r.error?.code ??
      r.error?.message ??
      (r.status === 'succeeded' ? 'ok' : r.status)
    ).slice(0, 500);
    await this.adapter.run(
      `INSERT INTO receipts (id, template_id, action_id, action_type, status, message, environment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, templateId, r.actionId, r.type, r.status, message, r.environment, this.ws.nowIso()],
    );
  }
}

/**
 * Split a receipt's output into the shape the UI shows. A user action's handler returns
 * `{ value, logs, envWrites }` (see UserCodeRegistry.runAction), so unwrap it; anything else (e.g.
 * the built-in `log` action) is surfaced as the output itself.
 */
function detailOf(output: unknown): Pick<ReceiptDto, 'output' | 'logs' | 'envWrites'> {
  if (output && typeof output === 'object' && 'value' in output && 'logs' in output) {
    const o = output as { value: unknown; logs?: unknown; envWrites?: unknown };
    return {
      output: o.value,
      logs: Array.isArray(o.logs) ? (o.logs as string[]) : [],
      envWrites: Array.isArray(o.envWrites) ? (o.envWrites as string[]) : [],
    };
  }
  return { output: output ?? null, logs: [], envWrites: [] };
}
