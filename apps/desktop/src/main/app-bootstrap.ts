import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from './storage/atomic-file';
import { parseJsonOr } from './util/json';
import { app, dialog, session, type BrowserWindow } from 'electron';
import { DATA_CAPABILITIES, httpRequestSchema, type FolderProxyDto } from '@swaft/shared';
import { ActionService } from './actions/ActionService';
import { ScenarioService } from './actions/ScenarioService';
import { AppStore } from './app-store/AppStore';
import { CryptoService } from './crypto/CryptoService';
import { SafeStorageCipher } from './auth/cipher';
import { getAuthService } from './auth/registry';
import { HttpService } from './http/HttpService';
import { SecretService } from './secret/SecretService';
import { BUILTIN_ACTION_TYPES } from './seebo/action-handlers';
import { SeeboHost, WIDGET_CAPABILITIES } from './seebo/SeeboHost';
import { UserCodeRegistry } from './usercode/UserCodeRegistry';
import { UtilityProcessRuntime } from './usercode/UtilityProcessRuntime';
import { getHttpService } from './services';
import {
  setActionService,
  setApiHistoryService,
  setApiRequestService,
  setApiRunService,
  setAppStore,
  setBatcherService,
  setChangelogService,
  setEnvironmentService,
  setHttpService,
  setOrganizationService,
  setPlatformDialogs,
  setReleaseService,
  setRenderService,
  setScenarioService,
  setSecretService,
  setSettingsService,
  setTemplateService,
  setUserCodeRegistry,
  setWorkspaceService,
  type PlatformDialogs,
} from './services';
import { createDbBackend } from './storage/worker-db-backend';
import { ApiHistoryService } from './workspace/ApiHistoryService';
import { ApiRequestService } from './workspace/ApiRequestService';
import { ApiRunService } from './workspace/ApiRunService';
import { BatcherService } from './workspace/BatcherService';
import { ChangelogService } from './workspace/ChangelogService';
import { EnvironmentService } from './workspace/EnvironmentService';
import { OrganizationService } from './workspace/OrganizationService';
import { ReleaseService } from './workspace/ReleaseService';
import { RenderService } from './workspace/RenderService';
import { SettingsService } from './workspace/SettingsService';
import { TemplateDataProvider } from './workspace/TemplateDataProvider';
import { TemplateService } from './workspace/TemplateService';
import { WorkspaceService } from './workspace/WorkspaceService';

const SWAFT_FILTER = { name: 'Swaft Workspace', extensions: ['swaft'] };

/**
 * Construct the Electron-backed M4 services (app-level store, workspace service, native dialogs) and
 * register them for the transport handlers. Electron-only; called once from the main entry. The DB
 * runs on a worker thread (`dbWorker.js`, emitted next to this module) with an in-process fallback.
 */
/** The signed-in username (for change attribution), or null if auth isn't ready. */
function currentUsername(): string | null {
  try {
    return getAuthService().currentUsername();
  } catch {
    return null;
  }
}

export function bootstrapWorkspace(getWindow: () => BrowserWindow | null): void {
  const appStore = new AppStore(join(app.getPath('userData'), 'app-store.json'));
  const crypto = new CryptoService();
  const workerFile = join(__dirname, 'dbWorker.js');

  const workspaceService = new WorkspaceService({
    createBackend: (bytes) => createDbBackend({ workerFile, bytes }),
    crypto,
    fs: {
      read: async (path) => {
        try {
          return await readFile(path);
        } catch {
          return null;
        }
      },
      // Atomic (temp + rename): a crash mid-save must never leave a torn `.swaft` behind.
      write: (path, bytes) => writeFileAtomic(path, bytes),
    },
    deviceId: () => appStore.getDeviceId(),
    onOpened: (summary) => appStore.recordRecent(summary),
  });

  const dialogs: PlatformDialogs = {
    pickCreateTarget: async (defaultName) => {
      const win = getWindow();
      const opts: Electron.SaveDialogOptions = {
        title: 'Create workspace',
        defaultPath: `${defaultName?.trim() || 'workspace'}.swaft`,
        filters: [SWAFT_FILTER],
      };
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      return res.canceled || !res.filePath ? null : res.filePath;
    },
    pickOpenTarget: async () => {
      const win = getWindow();
      const opts: Electron.OpenDialogOptions = {
        title: 'Open workspace',
        properties: ['openFile'],
        filters: [SWAFT_FILTER],
      };
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return res.canceled || res.filePaths.length === 0 ? null : (res.filePaths[0] ?? null);
    },
    pickSaveTarget: async (defaultName) => {
      const win = getWindow();
      const opts: Electron.SaveDialogOptions = { title: 'Export', defaultPath: defaultName };
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      return res.canceled || !res.filePath ? null : res.filePath;
    },
  };

  const organization = new OrganizationService(workspaceService);
  const settings = new SettingsService(workspaceService);
  const changelog = new ChangelogService(workspaceService, currentUsername);
  const templates = new TemplateService(workspaceService, organization, changelog);
  const releases = new ReleaseService(workspaceService, templates, changelog);
  // The `template` data capability reads other `json` templates' effective source as JSON objects.
  const templateData = new TemplateDataProvider(workspaceService, releases);
  // The `env` data capability reads the active environment's variables (no user input needed).
  const environments = new EnvironmentService(workspaceService, currentUsername);
  // User-authored capabilities run in a dedicated process (never in main): losing that isolation
  // must fail loudly, so there is no in-process fallback here.
  // The isolated process has no network of its own: its HTTP lands here, in the same service that
  // applies the workspace's blocked domains, enforced headers and redirect re-validation.
  const scriptRuntime = new UtilityProcessRuntime(join(__dirname, 'scriptHost.js'), {
    http: async (payload) => {
      const parsed = httpRequestSchema.parse(payload);
      const response = await getHttpService().send(parsed);
      return { ...response, json: parseJsonOr<unknown>(response.body, undefined) };
    },
  });
  const userCapabilities = new UserCodeRegistry(workspaceService, {
    templates,
    releases,
    environments,
    settings,
    runtime: scriptRuntime,
    reservedNames: [...WIDGET_CAPABILITIES, ...DATA_CAPABILITIES, ...BUILTIN_ACTION_TYPES],
    // Approvals live in the app-level store, never in the `.swaft` — a workspace must not vouch
    // for the code it carries.
    trust: appStore,
  });
  const host = new SeeboHost({}, { templateData, envData: environments, userCapabilities });
  const render = new RenderService(workspaceService, templates, host, releases);
  const apiRequest = new ApiRequestService(templates, host, organization);
  const batcher = new BatcherService(templates, releases, host);
  const actionService = new ActionService(workspaceService, {
    host,
    releases,
    render,
    settings,
    currentUsername,
  });

  const secretService = new SecretService(
    join(app.getPath('userData'), 'secrets.json'),
    new SafeStorageCipher(),
  );
  // Folder-propagated proxies route through a dedicated Electron session per proxy target, so the
  // Chromium network stack handles both http and https (CONNECT tunneling) transparently.
  const proxyFetchFn = (proxy: FolderProxyDto): typeof fetch => {
    const rule = `${proxy.protocol}://${proxy.hostname}:${proxy.port}`;
    const ses = session.fromPartition(`swaft-proxy:${rule}`);
    return async (input, init) => {
      // `<-loopback>` removes Chromium's default localhost bypass, so local targets are proxied too.
      await ses.setProxy({ proxyRules: rule, proxyBypassRules: '<-loopback>' });
      return ses.fetch(input instanceof URL ? input.toString() : input, init);
    };
  };
  const httpService = new HttpService({
    fetchFn: (...args) => fetch(...args),
    proxyFetchFn,
    secrets: secretService,
    settings,
  });
  const apiHistory = new ApiHistoryService(workspaceService);
  const apiRun = new ApiRunService({
    requests: apiRequest,
    http: httpService,
    history: apiHistory,
    code: userCapabilities,
  });
  const scenarioService = new ScenarioService(workspaceService, {
    templates,
    releases,
    render,
    host,
    apiRun,
    userCode: userCapabilities,
  });

  setAppStore(appStore);
  setWorkspaceService(workspaceService);
  setOrganizationService(organization);
  setSettingsService(settings);
  setChangelogService(changelog);
  setTemplateService(templates);
  setReleaseService(releases);
  setRenderService(render);
  setSecretService(secretService);
  setHttpService(httpService);
  setApiHistoryService(apiHistory);
  setApiRequestService(apiRequest);
  setApiRunService(apiRun);
  setUserCodeRegistry(userCapabilities);
  setBatcherService(batcher);
  setActionService(actionService);
  setScenarioService(scenarioService);
  setEnvironmentService(environments);
  setPlatformDialogs(dialogs);
}
