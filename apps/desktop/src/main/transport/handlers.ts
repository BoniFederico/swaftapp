import {
  type ActionExecuteRequest,
  type ApiAnalyzeRequest,
  type BatchAnalyzeRequest,
  type BatchRenderRequest,
  type DbExportRequest,
  type DbQueryRequest,
  type ErrorEnvelope,
  type FolderCreateRequest,
  type FolderMoveRequest,
  type TemplateMoveRequest,
  type HttpSendRequest,
  type IdRequest,
  type InputStateGetRequest,
  type InputStateSetRequest,
  type NameColorRequest,
  type SecretSetRequest,
  type OpName,
  type PingRequest,
  type PingResponse,
  type Preferences,
  type ProjectCreateRequest,
  type ReleaseCreateRequest,
  type ReleaseUpdateRequest,
  type ReleaseDeleteRequest,
  type RenameRequest,
  type RestrictionCreateRequest,
  type ReleaseSelectionSetRequest,
  type SignInRequest,
  type SignUpRequest,
  type RenderSourceRequest,
  type SourceRequest,
  type TemplateCreateRequest,
  type TemplateRefRequest,
  type TemplateRenderRequest,
  type TemplateTagAddRequest,
  type TemplateTagRemoveRequest,
  type TemplateUpdateSourceRequest,
  type UnlockRequest,
  type WorkspaceCreateRequest,
  type WorkspaceOpenRequest,
  type WorkspaceSettingsUpdate,
  type WorkspaceUpdateRequest,
  type DialogCreateTargetRequest,
} from '@swaft/shared';
import { getAuthService } from '../auth/registry';
import { toErrorEnvelope } from '../errors';
import { writeFile } from 'node:fs/promises';
import { toCsv, toJson } from '../db/export';
import {
  getActionService,
  getApiHistoryService,
  getApiRequestService,
  getAppStore,
  getBatcherService,
  getChangelogService,
  getDatabaseService,
  getDbHistoryService,
  getHttpService,
  getOrganizationService,
  getPlatformDialogs,
  getReleaseService,
  getRenderService,
  getSecretService,
  getSettingsService,
  getTemplateService,
  getWorkspaceService,
} from '../services';

/**
 * Op handlers. Each receives an already-validated request (dispatch validates against the op's
 * schema first, and enforces the session guard) and returns either the response DTO (raw data) or an
 * ErrorEnvelope. Handlers delegate to services; `svc()` maps any coded `AppError` to the envelope.
 */
type Handler = (payload: unknown) => Promise<unknown> | unknown;

function ping(payload: unknown): PingResponse {
  const req = payload as PingRequest; // validated by dispatch against pingRequestSchema
  return { pong: true, echo: req.echo ?? '', ts: new Date().toISOString() };
}

/** Run a service call, mapping a coded `AppError` (incl. `AuthError`) to the transport envelope. */
async function svc<T>(fn: () => Promise<T> | T): Promise<T | ErrorEnvelope> {
  try {
    return await fn();
  } catch (err) {
    const envelope = toErrorEnvelope(err);
    if (envelope) return envelope;
    throw err;
  }
}

export const handlers: Record<OpName, Handler> = {
  'system.ping': ping,

  // Auth / session (M3)
  'auth.status': () => getAuthService().status(),
  'auth.signUp': (p) => svc(() => getAuthService().signUp(p as SignUpRequest)),
  'auth.signIn': (p) => svc(() => getAuthService().signIn(p as SignInRequest)),
  'auth.unlock': (p) => svc(() => getAuthService().unlock(p as UnlockRequest)),
  'auth.signOut': () => getAuthService().signOut(),
  'auth.lock': () => getAuthService().lock(),
  'session.whoami': () => svc(() => getAuthService().whoami()),

  // Preferences (M4)
  'prefs.get': () => ({ preferences: getAppStore().getPreferences() }),
  'prefs.set': (p) => ({ preferences: getAppStore().setPreferences(p as Preferences) }),

  // Workspace lifecycle (M4)
  'workspace.create': (p) =>
    svc(async () => ({ workspace: await getWorkspaceService().create(p as WorkspaceCreateRequest) })),
  'workspace.open': (p) =>
    svc(async () => ({ workspace: await getWorkspaceService().open(p as WorkspaceOpenRequest) })),
  'workspace.close': () =>
    svc(async () => {
      await getWorkspaceService().close();
      return { workspace: null };
    }),
  'workspace.current': () => ({ workspace: getWorkspaceService().current() }),
  'workspace.update': (p) =>
    svc(async () => ({ workspace: await getWorkspaceService().update(p as WorkspaceUpdateRequest) })),
  'workspace.recent': () => ({ items: getAppStore().getRecent() }),

  // Native dialogs (M4)
  'dialog.createTarget': (p) =>
    svc(async () => ({
      path: await getPlatformDialogs().pickCreateTarget((p as DialogCreateTargetRequest).defaultName),
    })),
  'dialog.openTarget': () => svc(async () => ({ path: await getPlatformDialogs().pickOpenTarget() })),

  // Organization tree (M5)
  'tree.get': () => svc(async () => ({ tree: await getOrganizationService().getTree() })),
  'project.create': (p) =>
    svc(async () => ({ tree: await getOrganizationService().createProject(p as ProjectCreateRequest) })),
  'project.rename': (p) =>
    svc(async () => {
      const r = p as RenameRequest;
      return { tree: await getOrganizationService().renameProject(r.id, r.name) };
    }),
  'project.delete': (p) =>
    svc(async () => ({ tree: await getOrganizationService().deleteProject((p as IdRequest).id) })),
  'folder.create': (p) =>
    svc(async () => ({ tree: await getOrganizationService().createFolder(p as FolderCreateRequest) })),
  'folder.rename': (p) =>
    svc(async () => {
      const r = p as RenameRequest;
      return { tree: await getOrganizationService().renameFolder(r.id, r.name) };
    }),
  'folder.delete': (p) =>
    svc(async () => ({ tree: await getOrganizationService().deleteFolder((p as IdRequest).id) })),
  'folder.move': (p) =>
    svc(async () => {
      const r = p as FolderMoveRequest;
      return { tree: await getOrganizationService().moveFolder(r.folderId, r.parentFolderId) };
    }),
  'template.move': (p) =>
    svc(async () => {
      const r = p as TemplateMoveRequest;
      return {
        tree: await getOrganizationService().moveTemplate(r.templateId, r.folderId, r.projectId),
      };
    }),
  'tag.create': (p) =>
    svc(async () => ({ tree: await getOrganizationService().createTag(p as NameColorRequest) })),
  'tag.delete': (p) =>
    svc(async () => ({ tree: await getOrganizationService().deleteTag((p as IdRequest).id) })),
  'tag.list': () => svc(async () => ({ tags: await getOrganizationService().listTags() })),
  'template.tags.list': (p) =>
    svc(async () => ({
      tags: await getOrganizationService().listTemplateTags((p as TemplateRefRequest).templateId),
    })),
  'template.tags.add': (p) =>
    svc(async () => {
      const r = p as TemplateTagAddRequest;
      return { tags: await getOrganizationService().addTemplateTag(r.templateId, r.name) };
    }),
  'template.tags.remove': (p) =>
    svc(async () => {
      const r = p as TemplateTagRemoveRequest;
      return { tags: await getOrganizationService().removeTemplateTag(r.templateId, r.tagId) };
    }),

  // Settings + restrictions (M5)
  'settings.get': () =>
    svc(async () => ({
      settings: await getSettingsService().getSettings(),
      restrictions: await getSettingsService().listRestrictions(),
    })),
  'settings.update': (p) =>
    svc(async () => ({
      settings: await getSettingsService().updateSettings(p as WorkspaceSettingsUpdate),
    })),
  'restriction.create': (p) =>
    svc(async () => ({
      restrictions: await getSettingsService().createRestriction(p as RestrictionCreateRequest),
    })),
  'restriction.delete': (p) =>
    svc(async () => ({
      restrictions: await getSettingsService().deleteRestriction((p as IdRequest).id),
    })),

  // Templates + Seebo rendering (M6)
  'template.create': (p) =>
    svc(async () => ({ tree: await getTemplateService().createTemplate(p as TemplateCreateRequest) })),
  'template.rename': (p) =>
    svc(async () => {
      const r = p as RenameRequest;
      return { tree: await getTemplateService().renameTemplate(r.id, r.name) };
    }),
  'template.delete': (p) =>
    svc(async () => ({ tree: await getTemplateService().deleteTemplate((p as IdRequest).id) })),
  'template.get': (p) =>
    svc(async () => ({ template: await getTemplateService().requireTemplate((p as IdRequest).id) })),
  'template.updateSource': (p) =>
    svc(async () => {
      const r = p as TemplateUpdateSourceRequest;
      return { template: await getTemplateService().updateSource(r.id, r.source, r.subtype) };
    }),
  'template.deleteDraft': (p) =>
    svc(async () => {
      const id = (p as IdRequest).id;
      await getReleaseService().deleteDraft(id);
      return { template: await getTemplateService().requireTemplate(id) };
    }),
  'template.analyze': (p) =>
    svc(async () => ({ requirements: await getRenderService().analyze((p as IdRequest).id) })),
  'template.render': (p) =>
    svc(async () => {
      const r = p as TemplateRenderRequest;
      return { result: await getRenderService().render(r.id, r.values) };
    }),
  'inputState.get': (p) =>
    svc(async () => ({
      values: await getRenderService().getInputState((p as InputStateGetRequest).templateId),
    })),
  'inputState.set': (p) =>
    svc(async () => {
      const r = p as InputStateSetRequest;
      return { values: await getRenderService().setInputState(r.templateId, r.values) };
    }),

  // Releases + changelog + selection (M7 / redesign)
  'release.create': (p) =>
    svc(async () => {
      const r = p as ReleaseCreateRequest;
      return {
        releases: await getReleaseService().createRelease(r.templateId, r.name, {
          source: r.source,
          subtype: r.subtype,
        }),
      };
    }),
  'release.update': (p) =>
    svc(async () => {
      const r = p as ReleaseUpdateRequest;
      return {
        releases: await getReleaseService().updateRelease(r.releaseId, {
          source: r.source,
          subtype: r.subtype,
        }),
      };
    }),
  'release.delete': (p) =>
    svc(async () => ({
      releases: await getReleaseService().deleteRelease((p as ReleaseDeleteRequest).releaseId),
    })),
  'release.list': (p) =>
    svc(async () => ({
      releases: await getReleaseService().listReleases((p as TemplateRefRequest).templateId),
    })),
  'changelog.list': (p) =>
    svc(async () => ({
      entries: await getChangelogService().listEntries((p as TemplateRefRequest).templateId),
    })),
  'releaseSelection.get': (p) =>
    svc(async () => ({
      releaseId: await getReleaseService().getSelection((p as TemplateRefRequest).templateId),
    })),
  'releaseSelection.set': (p) =>
    svc(async () => {
      const r = p as ReleaseSelectionSetRequest;
      return { releaseId: await getReleaseService().setSelection(r.templateId, r.releaseId) };
    }),
  'render.analyzeSource': (p) =>
    svc(async () => ({
      requirements: await getRenderService().analyzeSource((p as SourceRequest).source),
    })),
  'render.validateSource': (p) =>
    svc(async () => ({
      diagnostics: await getRenderService().validateSource((p as SourceRequest).source),
    })),
  'render.renderSource': (p) =>
    svc(async () => {
      const r = p as RenderSourceRequest;
      return { result: await getRenderService().renderSource(r.source, r.values) };
    }),

  // API templates + HTTP client (M8) + formula resolution (API-view automation, Fase 1)
  'http.send': (p) =>
    svc(async () => {
      const r = p as HttpSendRequest;
      // Resolve `${ … }` formulas in the request fields against the supplied inputs (when bound to a
      // template); without a template there is no project context, so the request is sent verbatim.
      let request = r.request;
      let rendered = false;
      if (r.templateId) {
        const resolved = await getApiRequestService().resolve(r.templateId, r.request, r.values ?? {});
        request = resolved.request;
        rendered = resolved.rendered;
      }
      const response = await getHttpService().send(request);
      if (r.templateId) {
        await getApiHistoryService().record(r.templateId, request.method, request.url, response.status);
      }
      // Surface the rendered request so the UI can show a "Request render" overview when formulas ran.
      return { response, rendered, request: rendered ? request : undefined };
    }),
  'api.analyze': (p) =>
    svc(async () => {
      const r = p as ApiAnalyzeRequest;
      return getApiRequestService().analyze(r.templateId, r.request, r.values ?? {});
    }),
  'api.history.list': (p) =>
    svc(async () => ({ items: await getApiHistoryService().list((p as TemplateRefRequest).templateId) })),
  'api.history.clear': (p) =>
    svc(async () => ({ items: await getApiHistoryService().clear((p as TemplateRefRequest).templateId) })),
  'api.history.delete': (p) =>
    svc(async () => {
      await getApiHistoryService().deleteEntry((p as IdRequest).id);
      return { ok: true } as const;
    }),
  'secret.set': (p) =>
    svc(() => {
      const r = p as SecretSetRequest;
      getSecretService().set(r.ref, r.value);
      return { refs: getSecretService().list() };
    }),
  'secret.list': () => ({ refs: getSecretService().list() }),

  // Read-only database client (M9)
  'db.query': (p) =>
    svc(async () => {
      const r = p as DbQueryRequest;
      try {
        const result = await getDatabaseService().query(r);
        await getDbHistoryService().record(r.engine, r.sql, `ok (${result.rowCount})`);
        return { result };
      } catch (err) {
        // Record blocked/failed attempts too (metadata only), then rethrow for the envelope.
        const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'error';
        await getDbHistoryService()
          .record(r.engine, r.sql, code)
          .catch(() => undefined);
        throw err;
      }
    }),
  'db.history.list': () => svc(async () => ({ items: await getDbHistoryService().list() })),
  'db.history.clear': () => svc(async () => ({ items: await getDbHistoryService().clear() })),
  'db.pickFile': () => svc(async () => ({ path: await getPlatformDialogs().pickDatabaseFile() })),
  'db.export': (p) =>
    svc(async () => {
      const r = p as DbExportRequest;
      const path = await getPlatformDialogs().pickSaveTarget(
        `${r.defaultName ?? 'export'}.${r.format}`,
      );
      if (path) {
        const content = r.format === 'csv' ? toCsv(r.columns, r.rows) : toJson(r.columns, r.rows);
        await writeFile(path, content, 'utf8');
      }
      return { path };
    }),

  // Batcher + actions (M10)
  'batch.analyze': (p) =>
    svc(async () => ({
      requirements: await getBatcherService().analyze((p as BatchAnalyzeRequest).templateIds),
    })),
  'batch.render': (p) =>
    svc(async () => {
      const r = p as BatchRenderRequest;
      return { result: await getBatcherService().render(r.templateIds, r.values) };
    }),
  'action.execute': (p) =>
    svc(async () => {
      const r = p as ActionExecuteRequest;
      const receipts = await getActionService().execute(r.templateId, {
        confirmedActions: r.confirmedActions,
        failFast: r.failFast,
        dryRun: r.dryRun,
      });
      return { receipts };
    }),
  'receipt.list': (p) =>
    svc(async () => ({
      receipts: await getActionService().list((p as TemplateRefRequest).templateId),
    })),
};
