import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActionService } from '../actions/ActionService';
import { AppStore } from '../app-store/AppStore';
import { getAuthService } from '../auth/registry';
import { IdentityCipher } from '../auth/testing';
import { CryptoService } from '../crypto/CryptoService';
import { DatabaseService } from '../db/DatabaseService';
import { HttpService } from '../http/HttpService';
import { SecretService } from '../secret/SecretService';
import { SeeboHost } from '../seebo/SeeboHost';
import {
  setActionService,
  setApiHistoryService,
  setApiRequestService,
  setAppStore,
  setBatcherService,
  setChangelogService,
  setDatabaseService,
  setDbHistoryService,
  setHttpService,
  setOrganizationService,
  setPlatformDialogs,
  setReleaseService,
  setRenderService,
  setSecretService,
  setSettingsService,
  setTemplateService,
  setWorkspaceService,
  type PlatformDialogs,
} from '../services';
import { InProcessDbBackend } from '../storage/db-backend';
import { ApiHistoryService } from './ApiHistoryService';
import { ApiRequestService } from './ApiRequestService';
import { BatcherService } from './BatcherService';
import { ChangelogService } from './ChangelogService';
import { DbHistoryService } from './DbHistoryService';
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
  opts: { createPath?: string; openPath?: string; fetchFn?: typeof fetch; dbFile?: string } = {},
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
    pickDatabaseFile: () => Promise.resolve(opts.dbFile ?? null),
    pickSaveTarget: () => Promise.resolve(null),
  };

  const organization = new OrganizationService(workspace);
  const settings = new SettingsService(workspace);
  const currentUsername = () => {
    try {
      return getAuthService().currentUsername();
    } catch {
      return null;
    }
  };
  const changelog = new ChangelogService(workspace, currentUsername);
  const templates = new TemplateService(workspace, organization, changelog);
  const releases = new ReleaseService(workspace, templates, changelog);
  const templateData = new TemplateDataProvider(workspace, releases);
  const host = new SeeboHost({}, { templateData });
  const render = new RenderService(workspace, templates, settings, host, releases);
  const apiRequest = new ApiRequestService(templates, settings, host);
  const batcher = new BatcherService(templates, releases, settings, host);
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
  const database = new DatabaseService({ fs: { read: (p) => Promise.resolve(files.get(p) ?? null) } });
  const dbHistory = new DbHistoryService(workspace);

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
  setDatabaseService(database);
  setDbHistoryService(dbHistory);
  setBatcherService(batcher);
  setActionService(actions);
  setPlatformDialogs(dialogs);
  return { files, appStore, workspace, actions };
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
  setDatabaseService(null);
  setDbHistoryService(null);
  setBatcherService(null);
  setActionService(null);
  setPlatformDialogs(null);
}
