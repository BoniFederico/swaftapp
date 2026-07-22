import { api as defaultClient, ApiClient } from './api-client/client';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AuthScreen } from './auth/AuthScreen';
import { useI18n } from './i18n/I18nProvider';
import { usePreferencesSync } from './settings/usePreferencesSync';
import { LoadingState } from './ui';
import { Homepage } from './workspace/Homepage';
import { WorkspaceProvider, useWorkspace } from './workspace/WorkspaceProvider';
import { WorkspaceView } from './workspace/WorkspaceView';

/**
 * App root (M3 auth gate + M4 workspaces). `AuthProvider` gates the app behind sign-in; once signed
 * in, `WorkspaceProvider` routes between the homepage (no workspace) and the open-workspace view,
 * and preferences are synced to the app-level store. Must be rendered within Theme/I18n/Toast
 * providers.
 */
export function App({ client = defaultClient }: { client?: ApiClient }) {
  return (
    <AuthProvider client={client}>
      <SignedInGate client={client} />
    </AuthProvider>
  );
}

function SignedInGate({ client }: { client: ApiClient }) {
  const { t } = useI18n();
  const { state } = useAuth();

  if (state === 'loading') {
    return (
      <div className="app">
        <LoadingState label={t('auth.busy')} />
      </div>
    );
  }
  if (state !== 'signed-in') return <AuthScreen />;

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
        <LoadingState label={t('auth.busy')} />
      </div>
    );
  }
  return current ? <WorkspaceView client={client} /> : <Homepage client={client} />;
}
