import type { ActionService } from './actions/ActionService';
import type { AppStore } from './app-store/AppStore';
import type { HttpService } from './http/HttpService';
import type { SecretService } from './secret/SecretService';
import type { UserCodeRegistry } from './usercode/UserCodeRegistry';
import type { ApiHistoryService } from './workspace/ApiHistoryService';
import type { ApiRequestService } from './workspace/ApiRequestService';
import type { ApiRunService } from './workspace/ApiRunService';
import type { BatcherService } from './workspace/BatcherService';
import type { ChangelogService } from './workspace/ChangelogService';
import type { EnvironmentService } from './workspace/EnvironmentService';
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
  /** Native "save as" for an arbitrary export file. */
  pickSaveTarget(defaultName: string): Promise<string | null>;
}

/** One nullable slot per service: `set` at bootstrap (or a fake in tests), `get` throws until then. */
function serviceSlot<T>(name: string): { get: () => T; set: (value: T | null) => void } {
  let current: T | null = null;
  return {
    get: () => {
      if (!current) throw new Error(`${name} not initialized`);
      return current;
    },
    set: (value: T | null) => {
      current = value;
    },
  };
}

export const { get: getAppStore, set: setAppStore } = serviceSlot<AppStore>('AppStore');
export const { get: getWorkspaceService, set: setWorkspaceService } =
  serviceSlot<WorkspaceService>('WorkspaceService');
export const { get: getPlatformDialogs, set: setPlatformDialogs } =
  serviceSlot<PlatformDialogs>('PlatformDialogs');
export const { get: getOrganizationService, set: setOrganizationService } =
  serviceSlot<OrganizationService>('OrganizationService');
export const { get: getSettingsService, set: setSettingsService } =
  serviceSlot<SettingsService>('SettingsService');
export const { get: getTemplateService, set: setTemplateService } =
  serviceSlot<TemplateService>('TemplateService');
export const { get: getRenderService, set: setRenderService } =
  serviceSlot<RenderService>('RenderService');
export const { get: getReleaseService, set: setReleaseService } =
  serviceSlot<ReleaseService>('ReleaseService');
export const { get: getChangelogService, set: setChangelogService } =
  serviceSlot<ChangelogService>('ChangelogService');
export const { get: getHttpService, set: setHttpService } = serviceSlot<HttpService>('HttpService');
export const { get: getSecretService, set: setSecretService } =
  serviceSlot<SecretService>('SecretService');
export const { get: getApiHistoryService, set: setApiHistoryService } =
  serviceSlot<ApiHistoryService>('ApiHistoryService');
export const { get: getApiRequestService, set: setApiRequestService } =
  serviceSlot<ApiRequestService>('ApiRequestService');
export const { get: getApiRunService, set: setApiRunService } =
  serviceSlot<ApiRunService>('ApiRunService');
export const { get: getUserCodeRegistry, set: setUserCodeRegistry } =
  serviceSlot<UserCodeRegistry>('UserCodeRegistry');
export const { get: getBatcherService, set: setBatcherService } =
  serviceSlot<BatcherService>('BatcherService');
export const { get: getActionService, set: setActionService } =
  serviceSlot<ActionService>('ActionService');
export const { get: getEnvironmentService, set: setEnvironmentService } =
  serviceSlot<EnvironmentService>('EnvironmentService');
