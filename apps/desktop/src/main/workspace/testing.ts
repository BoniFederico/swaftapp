import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DATA_CAPABILITIES } from '@swaft/shared';
import { ActionService } from '../actions/ActionService';
import { AppStore } from '../app-store/AppStore';
import { CryptoService } from '../crypto/CryptoService';
import { GitOpsService } from '../git/GitOpsService';
import { SystemGitService } from '../git/GitService';
import { HttpService } from '../http/HttpService';
import { BUILTIN_ACTION_TYPES } from '../seebo/action-handlers';
import { SecretService } from '../secret/SecretService';
import { IdentityCipher } from '../secret/testing';
import { SeeboHost, WIDGET_CAPABILITIES } from '../seebo/SeeboHost';
import {
  setActionService,
  setApiHistoryService,
  setApiRequestService,
  setApiRunService,
  setAppStore,
  setBatcherService,
  setChangelogService,
  setEnvironmentService,
  setGitOpsService,
  setHttpService,
  setOrganizationService,
  setPlatformDialogs,
  setReleaseService,
  setRenderService,
  setSecretService,
  setSettingsService,
  setTemplateService,
  setUserCodeRegistry,
  setWorkspaceService,
  type PlatformDialogs,
} from '../services';
import { InProcessDbBackend } from '../storage/db-backend';
import type { ScriptRuntime } from '../usercode/ScriptRuntime';
import { UserCodeRegistry } from '../usercode/UserCodeRegistry';
import { ApiHistoryService } from './ApiHistoryService';
import { ApiRequestService } from './ApiRequestService';
import { ApiRunService } from './ApiRunService';
import { BatcherService } from './BatcherService';
import { ChangelogService } from './ChangelogService';
import { EnvironmentService } from './EnvironmentService';
import { OrganizationService } from './OrganizationService';
import { ReleaseService } from './ReleaseService';
import { RenderService } from './RenderService';
import { SettingsService } from './SettingsService';
import { TemplateDataProvider } from './TemplateDataProvider';
import { TemplateService } from './TemplateService';
import { WorkspaceService, type WorkspaceFs } from './WorkspaceService';

/**
 * Register an in-memory M4 backend (app store + workspace service over an in-process DB + fake native
 * dialogs) into the services registry. Used by component tests that drive the real dispatch path.
 */
export function installTestWorkspaceBackend(
  opts: { createPath?: string; openPath?: string; fetchFn?: typeof fetch } = {},
) {
  const files = new Map<string, Uint8Array>();
  const fs: WorkspaceFs = {
    read: (p) => Promise.resolve(files.get(p) ?? null),
    write: (p, bytes) => {
      files.set(p, bytes);
      return Promise.resolve();
    },
  };
  const dir = mkdtempSync(join(tmpdir(), 'swaft-rtest-'));
  const appStore = new AppStore(join(dir, 'app-store.json'));
  const workspace = new WorkspaceService({
    createBackend: (bytes) => InProcessDbBackend.open(bytes),
    crypto: new CryptoService(),
    fs,
    deviceId: () => appStore.getDeviceId(),
    onOpened: (summary) => appStore.recordRecent(summary),
  });
  const dialogs: PlatformDialogs = {
    pickCreateTarget: () => Promise.resolve(opts.createPath ?? 'mem://new.swaft'),
    pickOpenTarget: () => Promise.resolve(opts.openPath ?? null),
    pickSaveTarget: () => Promise.resolve(null),
    pickDirectory: () => Promise.resolve(null),
  };

  const organization = new OrganizationService(workspace);
  const settings = new SettingsService(workspace);
  // No user concept — attribution is null (the injection seam is kept for a future hosted backend).
  const currentUsername = () => null;
  const changelog = new ChangelogService(workspace, currentUsername);
  const templates = new TemplateService(workspace, organization, changelog);
  const releases = new ReleaseService(workspace, templates, changelog);
  const templateData = new TemplateDataProvider(workspace, releases);
  const environments = new EnvironmentService(workspace, currentUsername);
  // Component tests never execute user JS; the registry is wired (like production) so ops such as
  // usercode.untrusted and api.run resolve, but an actual run fails loudly.
  const runtime: ScriptRuntime = {
    run: () => Promise.reject(new Error('no script runtime in component tests')),
    dispose: () => Promise.resolve(),
  };
  const userCapabilities = new UserCodeRegistry(workspace, {
    templates,
    releases,
    environments,
    settings,
    runtime,
    reservedNames: [...WIDGET_CAPABILITIES, ...DATA_CAPABILITIES, ...BUILTIN_ACTION_TYPES],
    trust: appStore,
  });
  const host = new SeeboHost({}, { templateData, envData: environments, userCapabilities });
  const render = new RenderService(workspace, templates, host, releases);
  const apiRequest = new ApiRequestService(templates, host, organization);
  const batcher = new BatcherService(templates, releases, host);
  const actions = new ActionService(workspace, {
    host,
    releases,
    render,
    settings,
    currentUsername,
  });

  const secrets = new SecretService(join(dir, 'secrets.json'), new IdentityCipher());
  const fetchFn = opts.fetchFn ?? (() => Promise.resolve(new Response('{}', { status: 200 })));
  const http = new HttpService({ fetchFn, secrets, settings });
  const apiHistory = new ApiHistoryService(workspace);

  setAppStore(appStore);
  setWorkspaceService(workspace);
  setOrganizationService(organization);
  setSettingsService(settings);
  setChangelogService(changelog);
  setTemplateService(templates);
  setReleaseService(releases);
  setRenderService(render);
  setSecretService(secrets);
  setHttpService(http);
  setApiHistoryService(apiHistory);
  setApiRequestService(apiRequest);
  setApiRunService(
    new ApiRunService({ requests: apiRequest, http, history: apiHistory, code: userCapabilities }),
  );
  setUserCodeRegistry(userCapabilities);
  setBatcherService(batcher);
  setActionService(actions);
  setEnvironmentService(environments);
  setGitOpsService(new GitOpsService(workspace, new SystemGitService()));
  setPlatformDialogs(dialogs);
  return { files, appStore, workspace, actions, environments };
}

export function resetTestWorkspaceBackend(): void {
  setAppStore(null);
  setWorkspaceService(null);
  setOrganizationService(null);
  setSettingsService(null);
  setChangelogService(null);
  setTemplateService(null);
  setReleaseService(null);
  setRenderService(null);
  setSecretService(null);
  setHttpService(null);
  setApiHistoryService(null);
  setApiRequestService(null);
  setApiRunService(null);
  setUserCodeRegistry(null);
  setBatcherService(null);
  setActionService(null);
  setEnvironmentService(null);
  setGitOpsService(null);
  setPlatformDialogs(null);
}
