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
  type SecretDeleteRequest,
  type SecretsResponse,
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
  type RenderSourceRequest,
  type SourceRequest,
  type ScenarioRunRequest,
  type ScenarioRunRefRequest,
  type ScenarioProvideInputRequest,
  type ScenarioRunListRequest,
  type ScenarioRunBatchRequest,
  type ScenarioBatchRefRequest,
  type CollectionImportRequest,
  type CollectionExportRequest,
  type ContainerExportRequest,
  type FileSaveTextRequest,
  type FileSaveFilesRequest,
  type TemplateCreateRequest,
  type TemplateRefRequest,
  type TemplateSearchRequest,
  type TemplateRenderRequest,
  type TemplateTagAddRequest,
  type TemplateTagRemoveRequest,
  type TemplateUpdateSourceRequest,
  type WorkspaceCreateRequest,
  type WorkspaceOpenRequest,
  type WorkspaceForgetRecentRequest,
  type WorkspaceSettingsUpdate,
  type WorkspaceUpdateRequest,
  type DialogCreateTargetRequest,
  type GitCommitRequest,
  type GitCheckoutRequest,
  type GitCreateBranchRequest,
  type GitCloneRequest,
  type GitPublishRequest,
  type GitFileDiffRequest,
} from '@swaft/shared';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AppError, toErrorEnvelope } from '../errors';
import { writeFileAtomic } from '../storage/atomic-file';
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
  getImportService,
  getExportService,
  getContainerService,
  getGitOpsService,
  getOrganizationService,
  getPlatformDialogs,
  getReleaseService,
  getRenderService,
  getScenarioService,
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

/** Secret names (never values) plus how well this machine protects them at rest. */
function secretsResponse(): SecretsResponse {
  const secrets = getSecretService();
  return { refs: secrets.list(), storage: secrets.storageLevel() };
}

export const handlers: Record<OpName, Handler> = {
  'system.ping': ping,

  // Preferences (M4)
  'prefs.get': () => ({ preferences: getAppStore().getPreferences() }),
  'prefs.set': (p) => ({ preferences: getAppStore().setPreferences(p as Preferences) }),

  // Workspace lifecycle (M4)
  'workspace.create': (p) =>
    svc(async () => ({ workspace: await getWorkspaceService().create(p as WorkspaceCreateRequest) })),
  'workspace.open': (p) =>
    svc(async () => {
      const r = p as WorkspaceOpenRequest;
      // A `.swaft` zip container is unzipped to a sibling folder and opened as a folder workspace
      // (open-standards plan D1). A legacy single-file SQLite `.swaft` returns null here and opens
      // as-is. An encrypted container throws PASSWORD_REQUIRED, prompting the same password dialog.
      const folder = await getContainerService().openAsContainer(r.path, r.password);
      const target: WorkspaceOpenRequest = folder ? { path: folder } : r;
      return { workspace: await getWorkspaceService().open(target) };
    }),
  'workspace.close': () =>
    svc(async () => {
      await getWorkspaceService().close();
      return { workspace: null };
    }),
  'workspace.current': () => ({ workspace: getWorkspaceService().current() }),
  'workspace.update': (p) =>
    svc(async () => ({ workspace: await getWorkspaceService().update(p as WorkspaceUpdateRequest) })),
  'workspace.recent': () => ({ items: getAppStore().getRecent() }),
  'workspace.forgetRecent': (p) => {
    getAppStore().removeRecent((p as WorkspaceForgetRecentRequest).path);
    return { items: getAppStore().getRecent() };
  },

  // Native dialogs (M4)
  'dialog.createTarget': (p) =>
    svc(async () => ({
      path: await getPlatformDialogs().pickCreateTarget((p as DialogCreateTargetRequest).defaultName),
    })),
  'dialog.openTarget': () => svc(async () => ({ path: await getPlatformDialogs().pickOpenTarget() })),
  'dialog.pickDirectory': () =>
    svc(async () => ({ path: await getPlatformDialogs().pickDirectory() })),

  // Git storage mode
  'git.status': () => svc(async () => ({ status: await getGitOpsService().status() })),
  'git.commit': (p) =>
    svc(async () => {
      const r = p as GitCommitRequest;
      return { status: await getGitOpsService().commit(r.message, r.force ?? false) };
    }),
  'git.push': () => svc(async () => ({ status: await getGitOpsService().push() })),
  'git.pull': () => svc(async () => ({ status: await getGitOpsService().pull() })),
  'git.fetch': () => svc(async () => ({ status: await getGitOpsService().fetch() })),
  'git.checkout': (p) =>
    svc(async () => ({ status: await getGitOpsService().checkout((p as GitCheckoutRequest).branch) })),
  'git.createBranch': (p) =>
    svc(async () => ({
      status: await getGitOpsService().createBranch((p as GitCreateBranchRequest).name),
    })),
  'git.discard': () => svc(async () => ({ status: await getGitOpsService().discard() })),
  'git.clone': (p) =>
    svc(async () => {
      const req = p as GitCloneRequest;
      return { workspace: await getGitOpsService().clone(req.url, req.parentDir) };
    }),
  'git.publish': (p) =>
    svc(async () => ({ status: await getGitOpsService().publish((p as GitPublishRequest).url) })),
  'git.available': () => svc(async () => getGitOpsService().available()),
  'git.reload': () => svc(async () => ({ status: await getGitOpsService().reload() })),
  'git.fileDiff': (p) =>
    svc(async () => getGitOpsService().fileDiff((p as GitFileDiffRequest).path)),

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
  'template.search': (p) =>
    svc(async () => ({ ids: await getTemplateService().search((p as TemplateSearchRequest).query) })),
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
      return secretsResponse();
    }),
  'secret.list': () => secretsResponse(),
  'secret.delete': (p) =>
    svc(() => {
      getSecretService().delete((p as SecretDeleteRequest).ref);
      return secretsResponse();
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
          secretVars: r.secretVars,
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

  // Scenarios (M11): run a workflow graph + poll its progress.
  'scenario.run': (p) =>
    svc(async () => {
      const r = p as ScenarioRunRequest;
      return getScenarioService().run({
        id: r.id,
        startNodeId: r.startNodeId,
        onlyNode: r.onlyNode,
        mode: r.mode,
        authorizeActions: r.authorizeActions,
        source: r.source,
      });
    }),
  'scenario.runStatus': (p) =>
    svc(() => getScenarioService().status((p as ScenarioRunRefRequest).runId)),
  'scenario.stop': (p) =>
    svc(async () => {
      await getScenarioService().stop((p as ScenarioRunRefRequest).runId);
      return { ok: true as const };
    }),
  'scenario.provideInput': (p) =>
    svc(async () => {
      const r = p as ScenarioProvideInputRequest;
      await getScenarioService().provideInput(r.runId, r.values, r.remember);
      return { ok: true as const };
    }),
  'scenario.resume': (p) =>
    svc(async () => {
      await getScenarioService().resume((p as ScenarioRunRefRequest).runId);
      return { ok: true as const };
    }),
  'scenario.runList': (p) =>
    svc(async () => ({ runs: await getScenarioService().list((p as ScenarioRunListRequest).scenarioId) })),
  'scenario.runClear': (p) =>
    svc(async () => ({ runs: await getScenarioService().clear((p as ScenarioRunListRequest).scenarioId) })),
  'scenario.runBatch': (p) =>
    svc(async () => {
      const r = p as ScenarioRunBatchRequest;
      return getScenarioService().runBatch({
        id: r.id,
        count: r.count,
        interRunDelayMs: r.interRunDelayMs,
        authorizeActions: r.authorizeActions,
        startNodeId: r.startNodeId,
        source: r.source,
      });
    }),
  'scenario.batchStatus': (p) =>
    svc(() => ({ batch: getScenarioService().batchStatus((p as ScenarioBatchRefRequest).batchId) })),
  'scenario.stopBatch': (p) =>
    svc(async () => {
      await getScenarioService().stopBatch((p as ScenarioBatchRefRequest).batchId);
      return { ok: true as const };
    }),

  // Open standards: materialize a neutral collection (parsed by the renderer's shared codecs).
  'collection.import': (p) =>
    svc(async () => {
      const r = p as CollectionImportRequest;
      const result = await getImportService().importCollection(r.collection, r.target);
      return { tree: await getOrganizationService().getTree(), result };
    }),
  'collection.export': (p) =>
    svc(async () => {
      const r = p as CollectionExportRequest;
      return getExportService().export(r.scope, r.format, r.conversion, r.environmentIds ?? []);
    }),
  // Package the open workspace into a portable `.swaft` zip container (D1), optionally encrypted.
  'container.export': (p) =>
    svc(async () => {
      const r = p as ContainerExportRequest;
      if (r.encrypt && (!r.password || r.password.length < 8)) {
        throw new AppError(
          'PASSWORD_REQUIRED',
          'validation',
          'A password of at least 8 characters is required to encrypt the container.',
        );
      }
      const bytes = await getContainerService().export(r.encrypt ? r.password : undefined);
      const name = getWorkspaceService().current()?.name ?? 'workspace';
      const path = await getPlatformDialogs().pickSaveTarget(`${name}.swaft`);
      if (path) await writeFileAtomic(path, bytes);
      return { path };
    }),
  // Save exported content to disk via the native dialogs (main-process only).
  'file.saveText': (p) =>
    svc(async () => {
      const r = p as FileSaveTextRequest;
      const path = await getPlatformDialogs().pickSaveTarget(r.suggestedName);
      if (path) await writeFileAtomic(path, r.content);
      return { path };
    }),
  'file.saveFiles': (p) =>
    svc(async () => {
      const r = p as FileSaveFilesRequest;
      const dir = await getPlatformDialogs().pickDirectory();
      if (!dir) return { dir: null, count: 0 };
      let count = 0;
      for (const f of r.files) {
        // Reject path traversal; write only within the chosen directory.
        if (f.path.split(/[\\/]/).includes('..')) continue;
        const dest = join(dir, f.path);
        await mkdir(dirname(dest), { recursive: true });
        await writeFileAtomic(dest, f.content);
        count++;
      }
      return { dir, count };
    }),
};
