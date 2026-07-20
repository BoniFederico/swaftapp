import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { app, dialog, session, type BrowserWindow } from 'electron';
import type { FolderProxyDto } from '@swaft/shared';
import { ActionService } from './actions/ActionService';
import { AppStore } from './app-store/AppStore';
import { CryptoService } from './crypto/CryptoService';
import { SafeStorageCipher } from './auth/cipher';
import { getAuthService } from './auth/registry';
import { HttpService } from './http/HttpService';
import { SecretService } from './secret/SecretService';
import { SeeboHost } from './seebo/SeeboHost';
import {
  setActionService,
  setApiHistoryService,
  setApiRequestService,
  setAppStore,
  setBatcherService,
  setChangelogService,
  setEnvironmentService,
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
} from './services';
import { createDbBackend } from './storage/worker-db-backend';
import { ApiHistoryService } from './workspace/ApiHistoryService';
import { ApiRequestService } from './workspace/ApiRequestService';
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
      write: (path, bytes) => writeFile(path, bytes),
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
  const host = new SeeboHost({}, { templateData, envData: environments });
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
  setBatcherService(batcher);
  setActionService(actionService);
  setEnvironmentService(environments);
  setPlatformDialogs(dialogs);
}
