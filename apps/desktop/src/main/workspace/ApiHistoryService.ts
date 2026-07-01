import { randomUUID } from 'node:crypto';
import type { ApiHistoryItem } from '@swaft/shared';
import { RepoBase } from './RepoBase';

interface ApiHistoryRow {
  id: string;
  template_id: string;
  method: string;
  url: string;
  status: number | null;
  created_at: string;
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
}
