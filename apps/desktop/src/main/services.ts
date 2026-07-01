import type { ActionService } from './actions/ActionService';
import type { AppStore } from './app-store/AppStore';
import type { DatabaseService } from './db/DatabaseService';
import type { HttpService } from './http/HttpService';
import type { SecretService } from './secret/SecretService';
import type { ApiHistoryService } from './workspace/ApiHistoryService';
import type { ApiRequestService } from './workspace/ApiRequestService';
import type { BatcherService } from './workspace/BatcherService';
import type { ChangelogService } from './workspace/ChangelogService';
import type { DbHistoryService } from './workspace/DbHistoryService';
import type { OrganizationService } from './workspace/OrganizationService';
import type { ReleaseService } from './workspace/ReleaseService';
import type { RenderService } from './workspace/RenderService';
import type { SettingsService } from './workspace/SettingsService';
import type { TemplateService } from './workspace/TemplateService';
import type { WorkspaceService } from './workspace/WorkspaceService';

/**
 * Process-wide handles to the main services, in one Electron-free module so the transport handlers
 * can reach them without dragging Electron (or the worker/dialog implementations) into test bundles.
 * The bootstrap constructs the real instances and registers them; tests register fakes.
 */
export interface PlatformDialogs {
  /** Native "save as" for a new `.swaft`; returns the chosen path or null if cancelled. */
  pickCreateTarget(defaultName?: string): Promise<string | null>;
  /** Native "open" for an existing `.swaft`; returns the chosen path or null if cancelled. */
  pickOpenTarget(): Promise<string | null>;
  /** Native "open" for a SQLite database file. */
  pickDatabaseFile(): Promise<string | null>;
  /** Native "save as" for an arbitrary export file. */
  pickSaveTarget(defaultName: string): Promise<string | null>;
}

let appStore: AppStore | null = null;
let workspaceService: WorkspaceService | null = null;
let dialogs: PlatformDialogs | null = null;

export function setAppStore(value: AppStore | null): void {
  appStore = value;
}
export function getAppStore(): AppStore {
  if (!appStore) throw new Error('AppStore not initialized');
  return appStore;
}

export function setWorkspaceService(value: WorkspaceService | null): void {
  workspaceService = value;
}
export function getWorkspaceService(): WorkspaceService {
  if (!workspaceService) throw new Error('WorkspaceService not initialized');
  return workspaceService;
}

export function setPlatformDialogs(value: PlatformDialogs | null): void {
  dialogs = value;
}
export function getPlatformDialogs(): PlatformDialogs {
  if (!dialogs) throw new Error('PlatformDialogs not initialized');
  return dialogs;
}

let organization: OrganizationService | null = null;
let settings: SettingsService | null = null;

export function setOrganizationService(value: OrganizationService | null): void {
  organization = value;
}
export function getOrganizationService(): OrganizationService {
  if (!organization) throw new Error('OrganizationService not initialized');
  return organization;
}

export function setSettingsService(value: SettingsService | null): void {
  settings = value;
}
export function getSettingsService(): SettingsService {
  if (!settings) throw new Error('SettingsService not initialized');
  return settings;
}

let templates: TemplateService | null = null;
let render: RenderService | null = null;

export function setTemplateService(value: TemplateService | null): void {
  templates = value;
}
export function getTemplateService(): TemplateService {
  if (!templates) throw new Error('TemplateService not initialized');
  return templates;
}

export function setRenderService(value: RenderService | null): void {
  render = value;
}
export function getRenderService(): RenderService {
  if (!render) throw new Error('RenderService not initialized');
  return render;
}

let releases: ReleaseService | null = null;
let changelog: ChangelogService | null = null;

export function setReleaseService(value: ReleaseService | null): void {
  releases = value;
}
export function getReleaseService(): ReleaseService {
  if (!releases) throw new Error('ReleaseService not initialized');
  return releases;
}

export function setChangelogService(value: ChangelogService | null): void {
  changelog = value;
}
export function getChangelogService(): ChangelogService {
  if (!changelog) throw new Error('ChangelogService not initialized');
  return changelog;
}

let http: HttpService | null = null;
let secrets: SecretService | null = null;
let apiHistory: ApiHistoryService | null = null;

export function setHttpService(value: HttpService | null): void {
  http = value;
}
export function getHttpService(): HttpService {
  if (!http) throw new Error('HttpService not initialized');
  return http;
}

export function setSecretService(value: SecretService | null): void {
  secrets = value;
}
export function getSecretService(): SecretService {
  if (!secrets) throw new Error('SecretService not initialized');
  return secrets;
}

export function setApiHistoryService(value: ApiHistoryService | null): void {
  apiHistory = value;
}
export function getApiHistoryService(): ApiHistoryService {
  if (!apiHistory) throw new Error('ApiHistoryService not initialized');
  return apiHistory;
}

let apiRequest: ApiRequestService | null = null;

export function setApiRequestService(value: ApiRequestService | null): void {
  apiRequest = value;
}
export function getApiRequestService(): ApiRequestService {
  if (!apiRequest) throw new Error('ApiRequestService not initialized');
  return apiRequest;
}

let database: DatabaseService | null = null;
let dbHistory: DbHistoryService | null = null;

export function setDatabaseService(value: DatabaseService | null): void {
  database = value;
}
export function getDatabaseService(): DatabaseService {
  if (!database) throw new Error('DatabaseService not initialized');
  return database;
}

export function setDbHistoryService(value: DbHistoryService | null): void {
  dbHistory = value;
}
export function getDbHistoryService(): DbHistoryService {
  if (!dbHistory) throw new Error('DbHistoryService not initialized');
  return dbHistory;
}

let batcher: BatcherService | null = null;
let actions: ActionService | null = null;

export function setBatcherService(value: BatcherService | null): void {
  batcher = value;
}
export function getBatcherService(): BatcherService {
  if (!batcher) throw new Error('BatcherService not initialized');
  return batcher;
}

export function setActionService(value: ActionService | null): void {
  actions = value;
}
export function getActionService(): ActionService {
  if (!actions) throw new Error('ActionService not initialized');
  return actions;
}
