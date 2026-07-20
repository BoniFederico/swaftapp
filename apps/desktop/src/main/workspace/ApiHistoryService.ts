import { randomUUID } from 'node:crypto';
import type { ApiHistoryItem, RequestActionOutcomeDto } from '@swaft/shared';
import { RepoBase } from './RepoBase';

interface ApiHistoryRow {
  id: string;
  template_id: string;
  method: string;
  url: string;
  status: number | null;
  created_at: string;
}

interface ApiActionRunRow {
  id: string;
  ref: string;
  trigger: string;
  status: string;
  output: string | null;
  logs: string | null;
  env_writes: string | null;
  error: string | null;
  created_at: string;
}

/** Parse a stored JSON column back to a value, tolerating a null/corrupt cell. */
function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 🔵 local-only, metadata-only API history (method/url/status — never request/response bodies). */
export class ApiHistoryService extends RepoBase {
  async record(templateId: string, method: string, url: string, status: number | null): Promise<void> {
    await this.adapter.run(
      `INSERT INTO api_history (id, template_id, method, url, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), templateId, method, url, status, this.ws.nowIso()],
    );
    await this.ws.save();
  }

  async list(templateId: string): Promise<ApiHistoryItem[]> {
    const rows = await this.adapter.all<ApiHistoryRow>(
      `SELECT id, template_id, method, url, status, created_at FROM api_history
       WHERE template_id = ? ORDER BY created_at DESC`,
      [templateId],
    );
    return rows.map((r) => ({
      id: r.id,
      templateId: r.template_id,
      method: r.method,
      url: r.url,
      status: r.status,
      createdAt: r.created_at,
    }));
  }

  async clear(templateId: string): Promise<ApiHistoryItem[]> {
    await this.adapter.run(`DELETE FROM api_history WHERE template_id = ?`, [templateId]);
    await this.ws.save();
    return [];
  }

  async deleteEntry(id: string): Promise<void> {
    await this.adapter.run(`DELETE FROM api_history WHERE id = ?`, [id]);
    await this.ws.save();
  }

  // --- Pre/post action history -----------------------------------------------

  /** Append what a request's pre/post actions did, one row per outcome. No-op for an empty batch. */
  async recordActions(templateId: string, outcomes: RequestActionOutcomeDto[]): Promise<void> {
    if (outcomes.length === 0) return;
    const now = this.ws.nowIso();
    for (const o of outcomes) {
      await this.adapter.run(
        `INSERT INTO api_action_runs (id, template_id, ref, trigger, status, output, logs, env_writes, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          templateId,
          o.ref,
          o.trigger,
          o.status,
          o.output === undefined ? null : JSON.stringify(o.output),
          JSON.stringify(o.logs ?? []),
          JSON.stringify(o.envWrites ?? []),
          o.error,
          now,
        ],
      );
    }
    await this.ws.save();
  }

  async listActions(templateId: string): Promise<RequestActionOutcomeDto[]> {
    const rows = await this.adapter.all<ApiActionRunRow>(
      `SELECT id, ref, trigger, status, output, logs, env_writes, error, created_at
         FROM api_action_runs WHERE template_id = ? ORDER BY created_at DESC, rowid DESC`,
      [templateId],
    );
    return rows.map((r) => ({
      ref: r.ref,
      trigger: r.trigger as 'pre' | 'post',
      status: r.status as RequestActionOutcomeDto['status'],
      output: parseJson<unknown>(r.output, null),
      logs: parseJson<string[]>(r.logs, []),
      envWrites: parseJson<string[]>(r.env_writes, []),
      error: r.error,
      createdAt: r.created_at,
    }));
  }

  /** Clear the persisted action history, all of it or just one trigger. */
  async clearActions(templateId: string, trigger?: 'pre' | 'post'): Promise<RequestActionOutcomeDto[]> {
    if (trigger) {
      await this.adapter.run(`DELETE FROM api_action_runs WHERE template_id = ? AND trigger = ?`, [
        templateId,
        trigger,
      ]);
    } else {
      await this.adapter.run(`DELETE FROM api_action_runs WHERE template_id = ?`, [templateId]);
    }
    await this.ws.save();
    return this.listActions(templateId);
  }
}
