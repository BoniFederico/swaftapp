import { useRef, useState } from 'react';
import type { TemplateType } from '@swaft/shared';
import type { ApiClient } from '../api-client/client';
import { AccountControls } from '../auth/AccountControls';
import { BatchDocumentView } from '../batcher/BatchDocumentView';
import { BatcherPanel } from '../batcher/BatcherPanel';
import { ApiView } from '../document/ApiView';
import { DocumentView } from '../document/DocumentView';
import { TemplateEditorModal } from '../document/TemplateEditorModal';
import { EnvironmentPicker } from '../environment/EnvironmentPicker';
import { EnvironmentProvider } from '../environment/EnvironmentProvider';
import { useI18n } from '../i18n/I18nProvider';
import { SettingsModal, type SettingsSectionId } from '../settings/SettingsModal';
import {
  ApiIcon,
  Button,
  ChevronRightIcon,
  CloseIcon,
  DocumentIcon,
  EmptyState,
  IconButton,
} from '../ui';
import { WorkingTree } from './WorkingTree';
import { useWorkspace } from './WorkspaceProvider';

const MIN_SIDE = 220;
const MAX_SIDE = 560;

/** An open template tab. `preview` (italic) tabs are replaced by the next single-clicked template;
 * double-clicking a tab pins it. `dirty` marks unsaved edits (the API/Document views report it up). */
type Tab = { id: string; type: TemplateType; name: string; preview: boolean; dirty: boolean };

/** The colored type glyph shown at the head of a tab. */
function TabIcon({ type }: { type: TemplateType }) {
  const className = `ws-tab__type ws-tab__type--${type}`;
  if (type === 'api') return <ApiIcon className={className} />;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('general');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [batch, setBatch] = useState<string[] | null>(null);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [sideWidth, setSideWidth] = useState(280);
  const resize = useRef<{ startX: number; startW: number } | null>(null);

  // Open a template in a tab. A single click opens (or reuses) a *preview* tab — at most one exists,
  // and the next single-clicked template replaces it. An already-open template is just re-activated.
  function openTemplate(id: string, type: TemplateType, name: string) {
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
  function activateTab(id: string) {
    setBatch(null);
    setActiveId(id);
  }
  function pinTab(id: string) {
    setTabs((prev) => prev.map((tb) => (tb.id === id ? { ...tb, preview: false } : tb)));
  }
  function closeTab(id: string) {
    setTabs((prev) => {
      const idx = prev.findIndex((tb) => tb.id === id);
      const next = prev.filter((tb) => tb.id !== id);
      if (activeId === id) setActiveId((next[idx] ?? next[idx - 1])?.id ?? null);
      return next;
    });
  }
  function setTabFlag(id: string, patch: Partial<Tab>) {
    setTabs((prev) =>
      prev.map((tb) => {
        if (tb.id !== id) return tb;
        const merged = { ...tb, ...patch };
        // Avoid needless re-renders when nothing actually changed.
        return tb.dirty === merged.dirty && tb.name === merged.name ? tb : merged;
      }),
    );
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
          <div>
            <div className="ws-title">
              {current?.icon ? `${current.icon} ` : ''}
              {current?.name}
            </div>
            <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
              <span className="ui-badge">{t('ws.storageLocal')}</span>
              <span className="ui-badge">
                {t('ws.executionMode')}: {current?.executionMode}
              </span>
              <span className="ui-badge">
                {current?.encrypted ? t('ws.encrypted') : t('ws.notEncrypted')}
              </span>
            </div>
          </div>
        </div>
        <div className="ws-actions">
          <EnvironmentPicker onManage={() => openSettings('environments')} />
          <Button variant="secondary" onClick={() => openSettings('general')}>
            {t('ws.settings')}
          </Button>
          <AccountControls />
          <Button variant="secondary" onClick={() => void close()}>
            {t('ws.close')}
          </Button>
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
              if (mode === 'edit') {
                if (id) setEditing(id);
                return;
              }
              if (id) openTemplate(id, type, name);
            }}
            onCloseTemplate={closeTab}
            onCollapse={() => setSideCollapsed(true)}
          />
          <BatcherPanel onLoadInputs={setBatch} />
          <div
            className="ws-side__resizer"
            onPointerDown={onSideResizeDown}
            role="separator"
            aria-label={t('tree.resizeSidebar')}
          />
        </div>
        <main className="ws-main">
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
              const shared = {
                client,
                templateId: tb.id,
                onDirtyChange: (dirty: boolean) => setTabFlag(tb.id, { dirty }),
                onTitleChange: (name: string) => setTabFlag(tb.id, { name }),
              };
              return (
                <div key={tb.id} className="ws-pane" hidden={!visible}>
                  {tb.type === 'api' ? <ApiView {...shared} /> : <DocumentView {...shared} />}
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
    </div>
    </EnvironmentProvider>
  );
}
