import { useEffect, useRef, useState } from 'react';
import type { TemplateType, UntrustedCapabilityDto } from '@swaft/shared';
import type { ApiClient } from '../api-client/client';
import { useAuth } from '../auth/AuthProvider';
import { BatchDocumentView } from '../batcher/BatchDocumentView';
import { BatcherPanel } from '../batcher/BatcherPanel';
import { ApiView } from '../document/ApiView';
import { CodeView } from '../document/CodeView';
import { DocumentView } from '../document/DocumentView';
import { ScenarioView } from '../scenario/ScenarioView';
import { TemplateEditorModal } from '../document/TemplateEditorModal';
import { EnvironmentPicker } from '../environment/EnvironmentPicker';
import { EnvironmentProvider } from '../environment/EnvironmentProvider';
import { useI18n } from '../i18n/I18nProvider';
import { SettingsModal, type SettingsSectionId } from '../settings/SettingsModal';
import {
  ApiIcon,
  Button,
  CapabilityIcon,
  ConfirmDialog,
  ChevronRightIcon,
  CloseIcon,
  DocumentIcon,
  EmptyState,
  FolderIcon,
  IconButton,
  LockIcon,
  LogoutIcon,
  ScenarioIcon,
  SettingsIcon,
} from '../ui';
import { FolderView } from './FolderView';
import { subscribeTreeChanged } from './treeBus';
import { WorkingTree } from './WorkingTree';
import { useWorkspace } from './WorkspaceProvider';

const MIN_SIDE = 220;
const MAX_SIDE = 560;

/** What an open tab shows: a template view, or the folder detail view. */
type TabKind = TemplateType | 'folder';

/** An open tab. `preview` (italic) tabs are replaced by the next single-clicked item;
 * double-clicking a tab pins it. `dirty` marks unsaved edits (the views report it up). */
type Tab = { id: string; type: TabKind; name: string; preview: boolean; dirty: boolean };

/** The colored type glyph shown at the head of a tab. */
function TabIcon({ type }: { type: TabKind }) {
  const className = `ws-tab__type ws-tab__type--${type}`;
  if (type === 'api') return <ApiIcon className={className} />;
  if (type === 'capability' || type === 'action') return <CapabilityIcon className={className} />;
  if (type === 'scenario') return <ScenarioIcon className={className} />;
  if (type === 'folder') return <FolderIcon className={className} />;
  return <DocumentIcon className={className} />;
}

/**
 * The open-workspace shell (M5): a persistent top bar (app logo → home, workspace identity, Settings,
 * account), the always-visible Working Tree on the left, and a full-width right area. Settings open as
 * an overlay modal (over the workspace). Document/render views fill the right area from M6.
 */
export function WorkspaceView({ client }: { client: ApiClient }) {
  const { t } = useI18n();
  const { current, close } = useWorkspace();
  const { lock } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('general');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [batch, setBatch] = useState<string[] | null>(null);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [sideWidth, setSideWidth] = useState(280);
  const [batcherEnabled, setBatcherEnabled] = useState(true);
  const [untrusted, setUntrusted] = useState<UntrustedCapabilityDto[]>([]);
  // The tab awaiting a "discard unsaved changes?" confirmation, or null.
  const [closing, setClosing] = useState<string | null>(null);
  const resize = useRef<{ startX: number; startW: number } | null>(null);

  // The Batcher panel visibility is a workspace restriction; re-read it when Settings close.
  useEffect(() => {
    if (settingsOpen) return;
    void client
      .call('settings.get')
      .then((res) => {
        setBatcherEnabled(res.settings.batcherEnabled);
        if (!res.settings.batcherEnabled) setBatch(null); // drop an open batch view too
      })
      .catch(() => undefined);
  }, [client, settingsOpen]);

  // Capabilities awaiting approval. Re-checked whenever the tree changes, so approving one (or
  // editing code, which revokes its approval) updates the banner without a reload.
  useEffect(() => {
    const refresh = () =>
      void client
        .call('usercode.untrusted')
        .then((res) => setUntrusted(res.items))
        .catch(() => setUntrusted([]));
    refresh();
    return subscribeTreeChanged(refresh);
  }, [client]);

  // Open an item in a tab. A single click opens (or reuses) a *preview* tab — at most one exists,
  // and the next single-clicked item replaces it. An already-open item is just re-activated.
  function openTab(id: string, type: TabKind, name: string) {
    setBatch(null);
    setActiveId(id);
    setTabs((prev) => {
      if (prev.some((tb) => tb.id === id)) return prev;
      const fresh: Tab = { id, type, name, preview: true, dirty: false };
      const previewIdx = prev.findIndex((tb) => tb.preview);
      if (previewIdx === -1) return [...prev, fresh];
      const next = [...prev];
      next[previewIdx] = fresh; // replace the existing preview tab, keeping its position
      return next;
    });
  }
  const openTemplate = (id: string, type: TemplateType, name: string) => openTab(id, type, name);
  const openFolder = (id: string, name: string) => openTab(id, 'folder', name);
  function activateTab(id: string) {
    setBatch(null);
    setActiveId(id);
  }
  function pinTab(id: string) {
    setTabs((prev) => prev.map((tb) => (tb.id === id ? { ...tb, preview: false } : tb)));
  }
  function removeTab(id: string) {
    tabCallbacks.current.delete(id);
    setTabs((prev) => {
      const idx = prev.findIndex((tb) => tb.id === id);
      const next = prev.filter((tb) => tb.id !== id);
      if (activeId === id) setActiveId((next[idx] ?? next[idx - 1])?.id ?? null);
      return next;
    });
  }

  /**
   * Close a tab. A tab with unsaved edits first asks for confirmation, so the changes are not lost
   * silently. `force` skips the prompt — used when the underlying template/folder was just deleted,
   * where its edits are moot and already confirmed.
   */
  function closeTab(id: string, force = false) {
    const tab = tabs.find((tb) => tb.id === id);
    if (!force && tab?.dirty) setClosing(id);
    else removeTab(id);
  }
  function setTabFlag(id: string, patch: Partial<Tab>) {
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((tb) => {
        if (tb.id !== id) return tb;
        const merged = { ...tb, ...patch };
        if (tb.dirty === merged.dirty && tb.name === merged.name) return tb;
        changed = true;
        return merged;
      });
      // Returning `prev` unchanged is what actually stops the re-render: `map` always builds a new
      // array, so a no-op patch would still count as new state. Views report their dirty flag from an
      // effect, and each re-render here hands them freshly-created callbacks — which would re-trigger
      // that effect and loop.
      return changed ? next : prev;
    });
  }

  // Stable per-tab callbacks: the views report dirty/title from effects that depend on these, so
  // their identity must survive shell re-renders — a fresh arrow per render would re-fire those
  // effects on every unrelated state change (this is the loop `setTabFlag` guards against).
  const tabCallbacks = useRef(
    new Map<string, { onDirtyChange: (dirty: boolean) => void; onTitleChange: (name: string) => void }>(),
  );
  function callbacksFor(id: string) {
    let cbs = tabCallbacks.current.get(id);
    if (!cbs) {
      cbs = {
        onDirtyChange: (dirty: boolean) => setTabFlag(id, { dirty }),
        onTitleChange: (name: string) => setTabFlag(id, { name }),
      };
      tabCallbacks.current.set(id, cbs);
    }
    return cbs;
  }

  function openSettings(section: SettingsSectionId) {
    setSettingsSection(section);
    setSettingsOpen(true);
  }

  function onSideResizeDown(e: React.PointerEvent) {
    e.preventDefault();
    resize.current = { startX: e.clientX, startW: sideWidth };
    const onMove = (ev: PointerEvent) => {
      if (!resize.current) return;
      const next = resize.current.startW + (ev.clientX - resize.current.startX);
      setSideWidth(Math.min(MAX_SIDE, Math.max(MIN_SIDE, next)));
    };
    const onUp = () => {
      resize.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return (
    <EnvironmentProvider client={client}>
    <div className="ws-shell">
      <header className="ws-topbar">
        <div className="ws-identity">
          <button
            type="button"
            className="ws-appname"
            onClick={() => void close()}
            title={t('ws.home')}
            aria-label={t('ws.home')}
          >
            Swaft<span className="accent">.</span>
          </button>
          <span className="ws-sep" aria-hidden="true" />
          <div className="ws-title">
            {current?.icon ? `${current.icon} ` : ''}
            {current?.name}
          </div>
          <div className="ws-meta">
            <span className="ui-badge">{t('ws.storageLocal')}</span>
            <span className="ui-badge">
              {t('ws.executionMode')}: {current?.executionMode}
            </span>
            <span className="ui-badge">
              {current?.encrypted ? t('ws.encrypted') : t('ws.notEncrypted')}
            </span>
          </div>
        </div>
        <div className="ws-actions">
          <EnvironmentPicker onManage={() => openSettings('environments')} />
          <IconButton label={t('ws.settings')} onClick={() => openSettings('general')}>
            <SettingsIcon />
          </IconButton>
          <IconButton label={t('account.lock')} onClick={() => void lock()}>
            <LockIcon />
          </IconButton>
          <IconButton label={t('ws.close')} onClick={() => void close()}>
            <LogoutIcon />
          </IconButton>
        </div>
      </header>

      <div className="ws-body">
        {sideCollapsed && (
          <div className="ws-rail">
            <IconButton label={t('tree.expandSidebar')} onClick={() => setSideCollapsed(false)}>
              <ChevronRightIcon />
            </IconButton>
          </div>
        )}
        {/* Kept mounted while collapsed (display:none) so the tree's state — selected project,
            expanded folders — survives collapsing and reopening the sidebar. */}
        <div
          className="ws-side"
          style={{ width: sideWidth, display: sideCollapsed ? 'none' : undefined }}
        >
          <WorkingTree
            client={client}
            openTemplateId={activeId}
            onOpenTemplate={(id, mode = 'view', type = 'document', name = '') => {
              if (!id) return;
              if (mode === 'edit') {
                setEditing(id);
                return;
              }
              openTemplate(id, type, name);
              if (mode === 'pin') pinTab(id); // preference: double-click consolidates the tab
            }}
            onOpenFolder={(folder) => openFolder(folder.id, folder.name)}
            onCloseTemplate={(id) => closeTab(id, true)}
            onCollapse={() => setSideCollapsed(true)}
          />
          {batcherEnabled && <BatcherPanel onLoadInputs={setBatch} />}
          <div
            className="ws-side__resizer"
            onPointerDown={onSideResizeDown}
            role="separator"
            aria-label={t('tree.resizeSidebar')}
          />
        </div>
        <main className="ws-main">
          {/* Code that arrived with this workspace is inert until reviewed; this is how it is found. */}
          {untrusted.length > 0 && (
            <div className="ws-trust" role="status">
              <span>{t('trust.banner', { n: untrusted.length })}</span>
              <span className="ws-trust__names">{untrusted.map((c) => c.name).join(', ')}</span>
              <Button
                variant="ghost"
                onClick={() => openTab(untrusted[0]!.templateId, 'capability', untrusted[0]!.name)}
              >
                {t('trust.review')}
              </Button>
            </div>
          )}
          {tabs.length > 0 && (
            <div className="ws-tabs" role="tablist" aria-label={t('ws.openTabs')}>
              {tabs.map((tb) => {
                const active = tb.id === activeId && !batch;
                return (
                  <div
                    key={tb.id}
                    role="tab"
                    aria-label={tb.name}
                    aria-selected={active}
                    className={`ws-tab${active ? ' ws-tab--active' : ''}${
                      tb.preview ? ' ws-tab--preview' : ''
                    }${tb.dirty ? ' ws-tab--dirty' : ''}`}
                    onClick={() => activateTab(tb.id)}
                    onDoubleClick={() => pinTab(tb.id)}
                  >
                    <TabIcon type={tb.type} />
                    <span className="ws-tab__name">{tb.name}</span>
                    <span className="ws-tab__dot" title={t('tab.unsaved')} aria-hidden="true" />
                    <button
                      type="button"
                      className="ws-tab__close"
                      aria-label={t('tab.close')}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tb.id);
                      }}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="ws-main__content">
            {batch ? (
              <BatchDocumentView key={batch.join(',')} client={client} templateIds={batch} />
            ) : tabs.length === 0 ? (
              <EmptyState title={t('ws.welcome.title')} hint={t('ws.welcome.hint')} />
            ) : null}

            {/* Keep every open tab mounted (hidden when inactive) so unsaved edits — API requests and
                Document input configs — survive switching tabs and tools. */}
            {tabs.map((tb) => {
              const visible = !batch && tb.id === activeId;
              const shared = { client, templateId: tb.id, ...callbacksFor(tb.id) };
              return (
                <div key={tb.id} className="ws-pane" hidden={!visible}>
                  {tb.type === 'folder' ? (
                    <FolderView
                      client={client}
                      folderId={tb.id}
                      onOpenTemplate={openTemplate}
                      onOpenFolder={openFolder}
                      onDirtyChange={shared.onDirtyChange}
                      onTitleChange={shared.onTitleChange}
                    />
                  ) : tb.type === 'api' ? (
                    <ApiView {...shared} />
                  ) : tb.type === 'capability' || tb.type === 'action' ? (
                    <CodeView {...shared} kind={tb.type} />
                  ) : tb.type === 'scenario' ? (
                    <ScenarioView {...shared} />
                  ) : (
                    <DocumentView {...shared} />
                  )}
                </div>
              );
            })}
          </div>
        </main>
      </div>

      {editing && (
        <TemplateEditorModal
          key={editing}
          client={client}
          templateId={editing}
          onClose={() => setEditing(null)}
        />
      )}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        client={client}
        initialSection={settingsSection}
      />

      <ConfirmDialog
        open={closing !== null}
        title={t('tab.closeUnsaved.title')}
        message={t('tab.closeUnsaved.message')}
        confirmLabel={t('tab.closeUnsaved.confirm')}
        cancelLabel={t('name.cancel')}
        onConfirm={() => {
          if (closing) removeTab(closing);
          setClosing(null);
        }}
        onClose={() => setClosing(null)}
      />
    </div>
    </EnvironmentProvider>
  );
}
