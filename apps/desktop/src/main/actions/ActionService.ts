import { randomUUID } from 'node:crypto';
import type { ReceiptDto } from '@swaft/shared';
import type { RenderPolicy, SeeboHost } from '../seebo/SeeboHost';
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

  private async policy(): Promise<RenderPolicy> {
    const s = await this.deps.settings.getSettings();
    return { allowedCapabilities: s.allowedCapabilities, allowedTypes: s.allowedTypes };
  }

  async execute(
    templateId: string,
    opts: { confirmedActions: string[]; failFast: boolean; dryRun?: boolean },
  ): Promise<ReceiptDto[]> {
    const policy = await this.policy();
    const { source } = await this.deps.releases.resolveSource(templateId);
    const values = await this.deps.render.getInputState(templateId);
    const state = await this.deps.host.render(source, values, policy);
    const plan = state.actions ?? [];
    if (plan.length === 0) return this.list(templateId);

    const settings = await this.deps.settings.getSettings();
    const sandbox = settings.executionMode !== 'dev';
    const result = await this.deps.host.executeActions(
      plan,
      {
        confirmedActions: opts.confirmedActions,
        failFast: opts.failFast,
        dryRun: opts.dryRun ?? false,
        permissions: [], // no actor-permission model yet; permissioned actions are skipped
        environment: 'test',
        actor: { username: this.deps.currentUsername() ?? 'unknown' },
        // Empty allow-list ⇒ no type restriction (handlers still gate). Sandbox forbids prod.
        policy: {
          ...(settings.allowedActions.length ? { allowedActions: settings.allowedActions } : {}),
          ...(sandbox ? { allowedEnvironments: ['test', 'preprod'] } : {}),
        },
        redact: () => '[redacted]',
      },
      policy,
    );

    for (const receipt of result.receipts) await this.persist(templateId, receipt);
    await this.ws.save();
    return this.list(templateId);
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

  private async persist(templateId: string, r: SeeboActionReceipt): Promise<void> {
    // Redacted: store status + an error code/message only — never the action input/output values.
    const message = (
      r.error?.code ??
      r.error?.message ??
      (r.status === 'succeeded' ? 'ok' : r.status)
    ).slice(0, 500);
    await this.adapter.run(
      `INSERT INTO receipts (id, template_id, action_id, action_type, status, message, environment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), templateId, r.actionId, r.type, r.status, message, r.environment, this.ws.nowIso()],
    );
  }
}
