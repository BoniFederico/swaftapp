import { useMemo, useState } from 'react';
import type { StorageMode } from '@swaft/shared';
import { ApiError } from '../api-client/client';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n/I18nProvider';
import { PreferencesDialog } from '../settings/PreferencesDialog';
import {
  CloseIcon,
  EmptyState,
  IconButton,
  LockIcon,
  LogoutIcon,
  SearchIcon,
  SettingsIcon,
  SplitButton,
} from '../ui';
import { CloneDialog } from '../git/CloneDialog';
import { CreateWorkspaceWizard } from './CreateWorkspaceWizard';
import { OpenPasswordDialog } from './OpenPasswordDialog';
import { useWorkspace } from './WorkspaceProvider';

/**
 * The signed-in landing page when no workspace is open (SWAFT_UI_SPEC.md §2): a centered brand hero,
 * a search box that filters the recent list, and two "listbox of buttons" entry points — Create
 * (Local / Git) and Open (from .swaft / from folder / clone from URL). The storage mode / open source
 * is chosen here so the create wizard and open flow start already scoped. Encrypted workspaces prompt
 * for their password on open.
 */
export function Homepage() {
  const { t } = useI18n();
  const { recent, open, pickOpenTarget, pickDirectory, gitAvailable, forgetRecent } = useWorkspace();
  const { profile, lock, signOut } = useAuth();

  const [query, setQuery] = useState('');
  const [wizardMode, setWizardMode] = useState<StorageMode | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
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

  async function openFolder() {
    const path = await pickDirectory();
    if (path) await tryOpen(path);
  }

  // Git entry points are hidden when no git binary is available (gitAvailable === false); while the
  // probe is still pending (null) we keep them so the UI doesn't flicker.
  const gitHidden = gitAvailable === false;

  const createItems = [
    { id: 'local', label: t('home.create.local') },
    ...(gitHidden ? [] : [{ id: 'git', label: t('home.create.git') }]),
  ];
  const openItems = [
    { id: 'file', label: t('home.open.file') },
    { id: 'folder', label: t('home.open.folder') },
    ...(gitHidden ? [] : [{ id: 'clone', label: t('home.open.clone') }]),
  ];

  function onCreate(id: string) {
    setWizardMode(id as StorageMode);
  }

  function onOpen(id: string) {
    if (id === 'file') void openViaDialog();
    else if (id === 'folder') void openFolder();
    else if (id === 'clone') setCloneOpen(true);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recent;
    return recent.filter(
      (w) => w.name.toLowerCase().includes(q) || w.path.toLowerCase().includes(q),
    );
  }, [recent, query]);

  return (
    <div className="home-shell">
      {/* Same top bar as the open-workspace shell: brand on the left, actions aligned right. */}
      <header className="ws-topbar">
        <div className="ws-identity">
          <span className="ws-appname ws-appname--static">
            Swaft<span className="accent">.</span>
          </span>
        </div>
        <div className="ws-actions">
          <span className="muted ws-user">
            {t('home.signedInAs', { name: profile?.displayName ?? '' })}
          </span>
          <span className="ws-sep" aria-hidden="true" />
          <IconButton label={t('prefs.open')} onClick={() => setPrefsOpen(true)}>
            <SettingsIcon />
          </IconButton>
          <IconButton label={t('account.lock')} onClick={() => void lock()}>
            <LockIcon />
          </IconButton>
          <IconButton label={t('account.signOut')} onClick={() => void signOut()}>
            <LogoutIcon />
          </IconButton>
        </div>
      </header>

      <div className="home-content">
      <div className="home__hero">
        <div className="brand brand--hero">
          Swaft<span className="accent">.</span>
        </div>
        <p className="subtitle">{t('app.subtitle')}</p>
      </div>

      <div className="home__controls">
        <div className="home-search">
          <SearchIcon className="home-search__icon" />
          <input
            type="search"
            className="home-search__input"
            placeholder={t('home.search')}
            aria-label={t('home.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="row home__actions">
          <SplitButton
            label={t('home.create')}
            ariaLabel={t('home.create.aria')}
            variant="primary"
            menuWidth={220}
            items={createItems}
            onPick={onCreate}
          />
          <SplitButton
            label={t('home.open')}
            ariaLabel={t('home.open.aria')}
            variant="secondary"
            menuWidth={200}
            items={openItems}
            onPick={onOpen}
          />
        </div>
      </div>

      <section className="home__recent">
        <h2 className="home__recentTitle">{t('home.recent.title')}</h2>
        {recent.length === 0 ? (
          <EmptyState title={t('home.recent.empty')} />
        ) : filtered.length === 0 ? (
          <EmptyState title={t('home.recent.noMatch')} />
        ) : (
          <ul className="recent-list">
            {filtered.map((w) => (
              <li key={w.path} className="recent-item">
                <button
                  type="button"
                  className="recent-item__open"
                  onClick={() => void tryOpen(w.path)}
                >
                  <span className="recent-item__name">{w.name}</span>
                  {w.encrypted && <span className="ui-badge">{t('home.encryptedBadge')}</span>}
                  <span className="recent-item__path muted">{w.path}</span>
                </button>
                <button
                  type="button"
                  className="recent-item__remove"
                  aria-label={t('home.recent.forget')}
                  title={t('home.recent.forget')}
                  onClick={() => void forgetRecent(w.path)}
                >
                  <CloseIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>

      <CreateWorkspaceWizard
        open={wizardMode !== null}
        storageMode={wizardMode ?? 'local'}
        onClose={() => setWizardMode(null)}
      />
      <CloneDialog open={cloneOpen} onClose={() => setCloneOpen(false)} />
      <OpenPasswordDialog
        open={pwDialogOpen}
        path={openPath}
        onClose={() => setPwDialogOpen(false)}
      />
      <PreferencesDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </div>
  );
}
