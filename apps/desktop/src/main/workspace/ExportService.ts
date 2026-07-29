import {
  toBruno,
  toHttpFile,
  toPostman,
  toPostmanEnvironment,
  variabilizeSeebo,
  hasSeeboLogic,
  type HttpRequestModel,
  type ImportedEnvironment,
  type ImportedRequest,
} from '@swaft/shared';
import type { EnvironmentService } from './EnvironmentService';
import type { OrganizationService } from './OrganizationService';
import type { TemplateService } from './TemplateService';

/**
 * Gathers `api` templates in a scope into an open collection and serializes them to an interchange
 * format (open-standards plan §6.3). Non-api templates have no request equivalent and are skipped;
 * the scope is a projection onto the api subset. Seebo formulas are converted per the caller's choice
 * (verbatim / variabilize) before serialization; the report lists what was downgraded.
 */

export type ExportScope =
  | { kind: 'template'; templateId: string }
  | { kind: 'folder'; folderId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'workspace' };

export type ExportFormat = 'postman' | 'http' | 'bruno';
export type ExportConversion = 'verbatim' | 'variabilize';

export interface ExportFile {
  path: string;
  content: string;
}
export interface ExportResult {
  files: ExportFile[];
  report: string[];
}

function safe(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'export';
}

function parseRequest(source: string): HttpRequestModel {
  try {
    const obj = JSON.parse(source) as Partial<HttpRequestModel>;
    if (obj && typeof obj === 'object' && typeof obj.method === 'string') return obj as HttpRequestModel;
  } catch {
    /* fall through */
  }
  return { method: 'GET', url: '' };
}

function convertField(s: string, conversion: ExportConversion): string {
  return conversion === 'variabilize' ? variabilizeSeebo(s) : s;
}

function convertRequest(req: HttpRequestModel, conversion: ExportConversion): HttpRequestModel {
  if (conversion === 'verbatim') return req;
  const out: HttpRequestModel = { ...req, url: convertField(req.url, conversion) };
  if (req.headers) {
    out.headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, convertField(v, conversion)]),
    );
  }
  if (req.body != null) out.body = convertField(req.body, conversion);
  if (req.auth) {
    const a = { ...req.auth };
    for (const key of ['token', 'username', 'password', 'key', 'value'] as const) {
      if (typeof a[key] === 'string') a[key] = convertField(a[key]!, conversion);
    }
    out.auth = a;
  }
  return out;
}

export class ExportService {
  constructor(
    private readonly deps: {
      organization: OrganizationService;
      templates: TemplateService;
      environments: EnvironmentService;
    },
  ) {}

  async export(
    scope: ExportScope,
    format: ExportFormat,
    conversion: ExportConversion,
    environmentIds: string[] = [],
  ): Promise<ExportResult> {
    const tree = await this.deps.organization.getTree();
    const folderById = new Map(tree.folders.map((f) => [f.id, f]));
    const projectById = new Map(tree.projects.map((p) => [p.id, p]));

    // Folder names from the project root down to (and including) `folderId`.
    const folderPath = (folderId: string | null): string[] => {
      const path: string[] = [];
      let id = folderId && folderId !== '' ? folderId : null;
      const guard = new Set<string>();
      while (id && !guard.has(id)) {
        guard.add(id);
        const f = folderById.get(id);
        if (!f) break;
        path.unshift(f.name);
        id = f.parentFolderId ?? null;
      }
      return path;
    };
    const projectIdOf = (t: { projectId: string | null; folderId: string | null }): string | null =>
      t.projectId ?? (t.folderId ? (folderById.get(t.folderId)?.projectId ?? null) : null);

    // Which templates are in scope, and how to root their folderPath.
    const descendants = (root: string): Set<string> => {
      const out = new Set<string>([root]);
      let added = true;
      while (added) {
        added = false;
        for (const f of tree.folders) {
          if (f.parentFolderId && out.has(f.parentFolderId) && !out.has(f.id)) {
            out.add(f.id);
            added = true;
          }
        }
      }
      return out;
    };

    let inScope: typeof tree.templates;
    let rootPath: (t: (typeof tree.templates)[number]) => string[];
    let name = 'Workspace';

    if (scope.kind === 'template') {
      inScope = tree.templates.filter((t) => t.id === scope.templateId);
      rootPath = () => [];
      name = inScope[0]?.name ?? 'request';
    } else if (scope.kind === 'folder') {
      const set = descendants(scope.folderId);
      const base = folderPath(scope.folderId);
      inScope = tree.templates.filter((t) => t.folderId && set.has(t.folderId));
      rootPath = (t) => folderPath(t.folderId).slice(base.length);
      name = folderById.get(scope.folderId)?.name ?? 'folder';
    } else if (scope.kind === 'project') {
      inScope = tree.templates.filter((t) => projectIdOf(t) === scope.projectId);
      rootPath = (t) => folderPath(t.folderId);
      name = projectById.get(scope.projectId)?.name ?? 'project';
    } else {
      inScope = tree.templates;
      rootPath = (t) => {
        const p = projectIdOf(t);
        const pn = p ? (projectById.get(p)?.name ?? '') : '';
        return [...(pn ? [pn] : []), ...folderPath(t.folderId)];
      };
    }

    const skipped: Record<string, number> = {};
    const requests: ImportedRequest[] = [];
    for (const t of inScope) {
      if (t.type !== 'api') {
        skipped[t.type] = (skipped[t.type] ?? 0) + 1;
        continue;
      }
      const full = await this.deps.templates.getTemplate(t.id);
      if (!full) continue;
      const request = convertRequest(parseRequest(full.source), conversion);
      requests.push({ name: t.name, folderPath: rootPath(t), request });
    }

    const report: string[] = [];
    for (const [type, n] of Object.entries(skipped)) {
      report.push(`Skipped ${n} ${type} template(s) — no request equivalent.`);
    }
    const withLogic = requests.filter((r) =>
      [r.request.url, r.request.body ?? '', ...Object.values(r.request.headers ?? {})].some((s) =>
        hasSeeboLogic(s),
      ),
    ).length;
    if (withLogic > 0) {
      report.push(`${withLogic} request(s) keep Seebo formulas a foreign tool won't evaluate.`);
    }

    const environments: ImportedEnvironment[] = [];
    let redactedSecrets = 0;
    for (const id of environmentIds) {
      const env = await this.deps.environments.get(id).catch(() => null);
      if (!env) continue;
      const secret = new Set(env.secretVars);
      redactedSecrets += secret.size;
      const vars = Object.fromEntries(Object.entries(env.vars).filter(([k]) => !secret.has(k)));
      environments.push({ name: env.name, vars });
    }
    if (redactedSecrets > 0) {
      report.push(
        `${redactedSecrets} secret-labeled variable(s) were left out of the exported environment(s).`,
      );
    }
    if (environments.length > 0 && format === 'http') {
      report.push(`${environments.length} environment(s) were not bundled — .http export has no environment file.`);
    }

    const collection = { name, requests, environments };
    const files = this.serialize(collection, format, name);
    return { files, report };
  }

  private serialize(
    collection: { name: string; requests: ImportedRequest[]; environments: ImportedEnvironment[] },
    format: ExportFormat,
    name: string,
  ): ExportFile[] {
    if (format === 'postman') {
      const files: ExportFile[] = [
        {
          path: `${safe(name)}.postman_collection.json`,
          content: `${JSON.stringify(toPostman(collection), null, 2)}\n`,
        },
      ];
      for (const env of collection.environments) {
        files.push({
          path: `${safe(env.name)}.postman_environment.json`,
          content: `${JSON.stringify(toPostmanEnvironment(env), null, 2)}\n`,
        });
      }
      return files;
    }
    if (format === 'bruno') {
      return toBruno(collection).map((f) => ({ path: `${safe(name)}/${f.path}`, content: f.content }));
    }
    // http: one file, requests separated by `###`
    const parts = collection.requests.map(
      (r) => `### ${r.folderPath.concat(r.name).join(' / ')}\n${toHttpFile(r.request)}`,
    );
    return [{ path: `${safe(name)}.http`, content: parts.join('\n') || '###\n' }];
  }
}
