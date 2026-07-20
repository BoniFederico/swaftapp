import {
  type ActionExecuteRequest,
  type ApiAnalyzeRequest,
  type BatchAnalyzeRequest,
  type BatchRenderRequest,
  type EnvCreateRequest,
  type EnvSelectionSetRequest,
  type EnvUpdateRequest,
  type ErrorEnvelope,
  type FolderCreateRequest,
  type FolderMoveRequest,
  type FolderUpdateRequest,
  type TemplateMoveRequest,
  type HttpSendRequest,
  type UserCodeRefRequest,
  type UserCodeRunRequest,
  type ApiActionsClearRequest,
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
import {
  getActionService,
  getApiHistoryService,
  getApiRequestService,
  getApiRunService,
  getUserCodeRegistry,
  getAppStore,
  getBatcherService,
  getChangelogService,
  getEnvironmentService,
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
  'folder.get': (p) =>
    svc(async () => ({ folder: await getOrganizationService().getFolder((p as IdRequest).id) })),
  'folder.update': (p) =>
    svc(async () => {
      const r = p as FolderUpdateRequest;
      return {
        folder: await getOrganizationService().updateFolderMeta(r.id, {
          headers: r.headers,
          proxy: r.proxy,
          auth: r.auth,
          actions: r.actions,
          notes: r.notes,
        }),
      };
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

  // Settings (M5)
  'settings.get': () => svc(async () => ({ settings: await getSettingsService().getSettings() })),
  'settings.update': (p) =>
    svc(async () => ({
      settings: await getSettingsService().updateSettings(p as WorkspaceSettingsUpdate),
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
    svc(() => {
      const r = p as HttpSendRequest;
      // Resolve formulas, run the attached pre/post actions around the call, record the history.
      return getApiRunService().send(r.templateId, r.request, r.values ?? {});
    }),
  'api.analyze': (p) =>
    svc(async () => {
      const r = p as ApiAnalyzeRequest;
      return getApiRequestService().analyze(r.templateId, r.request, r.values ?? {});
    }),
  'usercode.describe': (p) =>
    svc(async () => ({
      capability: await getUserCodeRegistry().describe((p as UserCodeRefRequest).templateId),
    })),
  'usercode.run': (p) =>
    svc(async () => {
      const r = p as UserCodeRunRequest;
      return getUserCodeRegistry().runOnce(r.templateId, r.args ?? {}, { dryRun: r.dryRun });
    }),
  'usercode.untrusted': () =>
    svc(async () => ({ items: await getUserCodeRegistry().untrusted() })),
  'usercode.trust': (p) =>
    svc(async () => ({
      capability: await getUserCodeRegistry().trust((p as UserCodeRefRequest).templateId),
    })),
  'api.actions.list': (p) =>
    svc(async () => ({
      outcomes: await getApiHistoryService().listActions((p as TemplateRefRequest).templateId),
    })),
  'api.actions.clear': (p) =>
    svc(async () => {
      const r = p as ApiActionsClearRequest;
      return { outcomes: await getApiHistoryService().clearActions(r.templateId, r.trigger) };
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

  // Environments + the `env(...)` capability (API-view automation, Fase 3)
  'env.list': () => svc(async () => ({ environments: await getEnvironmentService().list() })),
  'env.get': (p) =>
    svc(async () => ({ environment: await getEnvironmentService().get((p as IdRequest).id) })),
  'env.create': (p) =>
    svc(async () => ({ environment: await getEnvironmentService().create(p as EnvCreateRequest) })),
  'env.update': (p) =>
    svc(async () => {
      const r = p as EnvUpdateRequest;
      return {
        environment: await getEnvironmentService().update(r.id, {
          name: r.name,
          description: r.description,
          vars: r.vars,
        }),
      };
    }),
  'env.delete': (p) =>
    svc(async () => ({ environments: await getEnvironmentService().delete((p as IdRequest).id) })),
  'env.selection.get': () =>
    svc(async () => ({ environmentId: await getEnvironmentService().getSelection() })),
  'env.selection.set': (p) =>
    svc(async () => ({
      environmentId: await getEnvironmentService().setSelection(
        (p as EnvSelectionSetRequest).environmentId,
      ),
    })),
};
