import { api as defaultClient, ApiClient } from './api-client/client';
import { useI18n } from './i18n/I18nProvider';
import { usePreferencesSync } from './settings/usePreferencesSync';
import { LoadingState } from './ui';
import { Homepage } from './workspace/Homepage';
import { WorkspaceProvider, useWorkspace } from './workspace/WorkspaceProvider';
import { WorkspaceView } from './workspace/WorkspaceView';

/**
 * App root (M4 workspaces). Routes between the homepage (no workspace open) and the open-workspace
 * view, and syncs preferences to the app-level store. Must be rendered within Theme/I18n/Toast
 * providers.
 */
export function App({ client = defaultClient }: { client?: ApiClient }) {
  return (
    <WorkspaceProvider client={client}>
      <WorkspaceRouter client={client} />
    </WorkspaceProvider>
  );
}

function WorkspaceRouter({ client }: { client: ApiClient }) {
  const { t } = useI18n();
  const { current, loading } = useWorkspace();
  usePreferencesSync(client);

  if (loading) {
    return (
      <div className="app">
        <LoadingState label={t('app.loading')} />
      </div>
    );
  }
  return current ? <WorkspaceView client={client} /> : <Homepage client={client} />;
}
