import { useState } from 'react';
import { ApiError } from '../api-client/client';
import { AccountControls } from '../auth/AccountControls';
import { useI18n } from '../i18n/I18nProvider';
import { PreferencesDialog } from '../settings/PreferencesDialog';
import { Button, Card, EmptyState, IconButton, SettingsIcon } from '../ui';
import { CreateWorkspaceWizard } from './CreateWorkspaceWizard';
import { OpenPasswordDialog } from './OpenPasswordDialog';
import { useWorkspace } from './WorkspaceProvider';

/**
 * The signed-in landing page when no workspace is open: recent list + create/open entry points
 * (SWAFT_UI_SPEC.md §2). Encrypted workspaces prompt for their password on open.
 */
export function Homepage() {
  const { t } = useI18n();
  const { recent, open, pickOpenTarget } = useWorkspace();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [pwDialogOpen, setPwDialogOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [openPath, setOpenPath] = useState<string | null>(null);

  async function tryOpen(path: string) {
    try {
      await open(path);
    } catch (err) {
      if (err instanceof ApiError && err.swaft.code === 'PASSWORD_REQUIRED') {
        setOpenPath(path);
        setPwDialogOpen(true);
      }
      // Other errors are surfaced via the workspace error state (kept simple on the homepage).
    }
  }

  async function openViaDialog() {
    const path = await pickOpenTarget();
    if (path) await tryOpen(path);
  }

  return (
    <div className="app">
      <div className="app-header">
        <div>
          <div className="brand">
            Swaft<span className="accent">.</span>
          </div>
          <p className="subtitle">{t('app.subtitle')}</p>
        </div>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <IconButton label={t('prefs.open')} onClick={() => setPrefsOpen(true)}>
            <SettingsIcon />
          </IconButton>
          <AccountControls />
        </div>
      </div>

      <Card title={t('home.recent.title')}>
        <div className="col" style={{ gap: 'var(--space-4)' }}>
          <div className="row">
            <Button onClick={() => setWizardOpen(true)}>{t('home.create')}</Button>
            <Button variant="secondary" onClick={() => void openViaDialog()}>
              {t('home.open')}
            </Button>
          </div>

          {recent.length === 0 ? (
            <EmptyState title={t('home.recent.empty')} />
          ) : (
            <ul className="recent-list">
              {recent.map((w) => (
                <li key={w.path}>
                  <button type="button" className="recent-item" onClick={() => void tryOpen(w.path)}>
                    <span className="recent-item__name">{w.name}</span>
                    {w.encrypted && <span className="ui-badge">{t('home.encryptedBadge')}</span>}
                    <span className="recent-item__path muted">{w.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <CreateWorkspaceWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
      <OpenPasswordDialog
        open={pwDialogOpen}
        path={openPath}
        onClose={() => setPwDialogOpen(false)}
      />
      <PreferencesDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </div>
  );
}
