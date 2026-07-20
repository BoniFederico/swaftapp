import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  FolderDetailDto,
  FolderProxyDto,
  HttpAuth,
  RequestAction,
  TemplateType,
  WorkspaceTree,
} from '@swaft/shared';
import { ApiClient, ApiError } from '../api-client/client';
import { AuthEditor } from '../document/AuthEditor';
import { KeyValueEditor } from '../document/KeyValueEditor';
import { RenderPreview } from '../document/RenderPreview';
import { RequestActionsEditor } from '../document/RequestActionsEditor';
import { SeeboField } from '../editor/SeeboField';
import { useI18n } from '../i18n/I18nProvider';
import {
  ApiIcon,
  Button,
  DocumentIcon,
  EmptyState,
  FolderIcon,
  Select,
  TextField,
  useToast,
  useSaveShortcut,
} from '../ui';
import { badgeColor, rowBadge } from './badges';
import { notifyTreeChanged, subscribeTreeChanged } from './treeBus';

type FolderTab = 'content' | 'headers' | 'auth' | 'actions' | 'proxy' | 'notes';

function TypeIcon({ type }: { type: TemplateType }) {
  const className = `fold-card__icon fold-card__icon--${type}`;
  return type === 'api' ? <ApiIcon className={className} /> : <DocumentIcon className={className} />;
}

/**
 * The folder detail view, opened as a tab by clicking a folder in the Working Tree. Four tabs (same
 * visual pattern as the API view): Content — a gallery of the folder's subfolders and templates;
 * Headers — headers propagated to every API call beneath the folder (values may carry Seebo
 * formulas); Proxy — a proxy propagated the same way; Notes — markdown documentation.
 */
export function FolderView({
  client,
  folderId,
  onOpenTemplate,
  onOpenFolder,
  onDirtyChange,
  onTitleChange,
}: {
  client: ApiClient;
  folderId: string;
  onOpenTemplate: (id: string, type: TemplateType, name: string) => void;
  onOpenFolder: (id: string, name: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onTitleChange?: (name: string) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState<FolderTab>('content');
  const [folder, setFolder] = useState<FolderDetailDto | null>(null);
  const [gone, setGone] = useState(false);
  const [tree, setTree] = useState<WorkspaceTree | null>(null);

  // Editable state per tab, each with its own dirty flag (saved independently).
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [headersDirty, setHeadersDirty] = useState(false);
  // Folder auth: null in the DB means "inherit from the parent chain" (the editor's default kind).
  const [auth, setAuth] = useState<HttpAuth>({ kind: 'inherit' });
  const [authDirty, setAuthDirty] = useState(false);
  const [inheritedAuth, setInheritedAuth] = useState<HttpAuth | null>(null);
  // Folder actions: this folder's own, plus the read-only actions inherited from ancestor folders.
  const [actions, setActions] = useState<RequestAction[]>([]);
  const [actionsDirty, setActionsDirty] = useState(false);
  const [inheritedActions, setInheritedActions] = useState<RequestAction[]>([]);
  const [availableActions, setAvailableActions] = useState<string[]>([]);
  const [proto, setProto] = useState<'http' | 'https'>('http');
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('');
  const [proxyDirty, setProxyDirty] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesPreview, setNotesPreview] = useState(false);
  // Mirrors of the dirty flags, readable from the async reload without re-subscribing.
  const dirtyRef = useRef({ headers: false, auth: false, actions: false, proxy: false, notes: false });
  dirtyRef.current = {
    headers: headersDirty,
    auth: authDirty,
    actions: actionsDirty,
    proxy: proxyDirty,
    notes: notesDirty,
  };

  useEffect(() => {
    onDirtyChange?.(headersDirty || authDirty || actionsDirty || proxyDirty || notesDirty);
  }, [headersDirty, authDirty, actionsDirty, proxyDirty, notesDirty, onDirtyChange]);

  // Load the folder + the tree (for the Content gallery), and stay in sync with outside mutations
  // (rename, moves, template create/delete) via the tree bus. Unsaved edits are never clobbered:
  // editable fields are only (re)seeded while their dirty flag is off.
  useEffect(() => {
    let cancelled = false;
    async function reload() {
      try {
        const [{ folder: f }, { tree: tr }] = await Promise.all([
          client.call('folder.get', { id: folderId }),
          client.call('tree.get'),
        ]);
        if (cancelled) return;
        setFolder(f);
        setTree(tr);
        setGone(false);
        onTitleChange?.(f.name);
        setAvailableActions(
          tr.templates.filter((tpl) => tpl.type === 'action').map((tpl) => tpl.name),
        );
        if (!dirtyRef.current.headers) setHeaders(f.headers);
        if (!dirtyRef.current.auth) setAuth(f.auth ?? { kind: 'inherit' });
        setInheritedAuth(f.inheritedAuth);
        if (!dirtyRef.current.actions) setActions(f.actions);
        setInheritedActions(f.inheritedActions);
        if (!dirtyRef.current.proxy) {
          setProto(f.proxy?.protocol ?? 'http');
          setHostname(f.proxy?.hostname ?? '');
          setPort(f.proxy ? String(f.proxy.port) : '');
        }
        if (!dirtyRef.current.notes) setNotes(f.notes);
      } catch {
        if (!cancelled) setGone(true);
      }
    }
    void reload();
    const unsubscribe = subscribeTreeChanged(() => void reload());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, folderId]);

  const subfolders = useMemo(
    () => (tree?.folders ?? []).filter((f) => f.parentFolderId === folderId),
    [tree, folderId],
  );
  const templates = useMemo(
    () => (tree?.templates ?? []).filter((tpl) => tpl.folderId === folderId),
    [tree, folderId],
  );
  const folderItemCount = (id: string): number =>
    (tree?.folders ?? []).filter((f) => f.parentFolderId === id).length +
    (tree?.templates ?? []).filter((tpl) => tpl.folderId === id).length;

  async function save(patch: {
    headers?: Record<string, string>;
    proxy?: FolderProxyDto | null;
    auth?: HttpAuth | null;
    actions?: RequestAction[];
    notes?: string;
  }): Promise<boolean> {
    try {
      const { folder: f } = await client.call('folder.update', { id: folderId, ...patch });
      setFolder(f);
      setInheritedAuth(f.inheritedAuth);
      setInheritedActions(f.inheritedActions);
      // Open API views may preview auth/policy inherited from this folder — let them refresh.
      notifyTreeChanged();
      return true;
    } catch (err) {
      toast.show(err instanceof ApiError ? err.swaft.message : String(err), 'error');
      return false;
    }
  }

  async function saveHeaders() {
    if (await save({ headers })) {
      setHeadersDirty(false);
      toast.show(t('toast.saved'), 'success');
    }
  }

  async function saveAuth() {
    if (await save({ auth: auth.kind === 'inherit' ? null : auth })) {
      setAuthDirty(false);
      toast.show(t('toast.saved'), 'success');
    }
  }

  async function saveActions() {
    if (await save({ actions })) {
      setActionsDirty(false);
      toast.show(t('toast.saved'), 'success');
    }
  }

  async function saveProxy() {
    const host = hostname.trim();
    const portNum = Number.parseInt(port, 10);
    if (host && (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)) {
      toast.show(t('folder.proxy.invalidPort'), 'error');
      return;
    }
    const proxy: FolderProxyDto | null = host
      ? { protocol: proto, hostname: host, port: portNum }
      : null;
    if (await save({ proxy })) {
      setProxyDirty(false);
      toast.show(t('toast.saved'), 'success');
    }
  }

  async function saveNotes() {
    if (await save({ notes })) {
      setNotesDirty(false);
      toast.show(t('toast.saved'), 'success');
    }
  }

  // Ctrl/Cmd+S saves every dirty tab — only for the visible folder view (tabs stay mounted hidden).
  const rootRef = useRef<HTMLDivElement>(null);
  useSaveShortcut(() => {
    if (headersDirty) void saveHeaders();
    if (authDirty) void saveAuth();
    if (actionsDirty) void saveActions();
    if (proxyDirty) void saveProxy();
    if (notesDirty) void saveNotes();
  }, rootRef);

  if (gone) {
    return (
      <div className="folder-view">
        <EmptyState title={t('folder.gone')} />
      </div>
    );
  }
  if (!folder) return null;

  const tabs: [FolderTab, string][] = [
    ['content', t('folder.tab.content')],
    ['headers', t('folder.tab.headers')],
    ['auth', t('folder.tab.auth')],
    ['actions', t('folder.tab.actions')],
    ['proxy', t('folder.tab.proxy')],
    ['notes', t('folder.tab.notes')],
  ];

  return (
    <div className="folder-view" ref={rootRef}>
      <div className="folder-view__head">
        <FolderIcon className="folder-view__glyph" />
        <span className="folder-view__name">{folder.name}</span>
        <span className="folder-view__count">
          {t('folder.content.items', { count: String(subfolders.length + templates.length) })}
        </span>
      </div>
      <div className="api__tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`api__tab${tab === key ? ' api__tab--active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="folder-view__body">
        {tab === 'content' && (
          <>
            {subfolders.length === 0 && templates.length === 0 ? (
              <EmptyState title={t('folder.content.empty')} />
            ) : (
              <div className="fold-gallery">
                {subfolders.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="fold-card fold-card--folder"
                    onClick={() => onOpenFolder(f.id, f.name)}
                  >
                    <FolderIcon className="fold-card__icon fold-card__icon--folder" />
                    <span className="fold-card__name">{f.name}</span>
                    <span className="fold-card__meta">
                      {t('folder.content.items', { count: String(folderItemCount(f.id)) })}
                    </span>
                  </button>
                ))}
                {templates.map((tpl) => {
                  const badge = rowBadge(tpl);
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      className="fold-card"
                      onClick={() => onOpenTemplate(tpl.id, tpl.type, tpl.name)}
                    >
                      <TypeIcon type={tpl.type} />
                      <span className="fold-card__name">{tpl.name}</span>
                      {badge && (
                        <span
                          className="fold-card__badge"
                          style={{ color: badgeColor(badge), borderColor: badgeColor(badge) }}
                        >
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {tab === 'headers' && (
          <div className="folder-form">
            <p className="field-hint">{t('folder.headers.hint')}</p>
            {/* The same key/value editor as the API view request headers (auto trailing row, Seebo
                highlighting in values, bulk edit). */}
            <KeyValueEditor
              value={headers}
              onChange={(h) => {
                setHeaders(h);
                setHeadersDirty(true);
              }}
            />
            <div className="settings-form__actions">
              <Button variant="primary" disabled={!headersDirty} onClick={() => void saveHeaders()}>
                {t('name.save')}
              </Button>
            </div>
          </div>
        )}

        {tab === 'auth' && (
          <div className="folder-form">
            <p className="field-hint">{t('folder.auth.hint')}</p>
            <AuthEditor
              auth={auth}
              onChange={(a) => {
                setAuth(a);
                setAuthDirty(true);
              }}
              inherited={inheritedAuth}
            />
            <div className="settings-form__actions">
              <Button variant="primary" disabled={!authDirty} onClick={() => void saveAuth()}>
                {t('name.save')}
              </Button>
            </div>
          </div>
        )}

        {tab === 'actions' && (
          <div className="folder-form">
            <p className="field-hint">{t('folder.actions.hint')}</p>
            {/* The same editor as an API request's Actions tab, plus the read-only actions this folder
                inherits from its ancestors. */}
            <RequestActionsEditor
              actions={actions}
              available={availableActions}
              onChange={(a) => {
                setActions(a);
                setActionsDirty(true);
              }}
              inherited={inheritedActions}
            />
            <div className="settings-form__actions">
              <Button variant="primary" disabled={!actionsDirty} onClick={() => void saveActions()}>
                {t('name.save')}
              </Button>
            </div>
          </div>
        )}

        {tab === 'proxy' && (
          <div className="folder-form">
            <p className="field-hint">{t('folder.proxy.hint')}</p>
            <div className="folder-proxy">
              <Select
                label={t('folder.proxy.protocol')}
                value={proto}
                onChange={(v) => {
                  setProto(v === 'https' ? 'https' : 'http');
                  setProxyDirty(true);
                }}
                options={[
                  { value: 'http', label: 'http' },
                  { value: 'https', label: 'https' },
                ]}
              />
              {/* The hostname may carry Seebo formulas → highlighted single-line editor. */}
              <div className="ui-field">
                <span className="ui-field__label">{t('folder.proxy.hostname')}</span>
                <SeeboField
                  ariaLabel={t('folder.proxy.hostname')}
                  placeholder="proxy.example.com"
                  value={hostname}
                  onChange={(v) => {
                    setHostname(v);
                    setProxyDirty(true);
                  }}
                />
              </div>
              <TextField
                label={t('folder.proxy.port')}
                value={port}
                placeholder="8080"
                onChange={(e) => {
                  setPort(e.target.value.replace(/[^\d]/g, ''));
                  setProxyDirty(true);
                }}
              />
            </div>
            <span className="field-hint">{t('folder.proxy.emptyHint')}</span>
            <div className="settings-form__actions">
              <Button variant="primary" disabled={!proxyDirty} onClick={() => void saveProxy()}>
                {t('name.save')}
              </Button>
            </div>
          </div>
        )}

        {tab === 'notes' && (
          <div className="folder-notes">
            <div className="folder-notes__bar">
              <div className="seg" role="tablist" aria-label={t('folder.tab.notes')}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!notesPreview}
                  className={`seg__btn${!notesPreview ? ' seg__btn--active' : ''}`}
                  onClick={() => setNotesPreview(false)}
                >
                  {t('folder.notes.edit')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={notesPreview}
                  className={`seg__btn${notesPreview ? ' seg__btn--active' : ''}`}
                  onClick={() => setNotesPreview(true)}
                >
                  {t('editor.preview')}
                </button>
              </div>
              <Button variant="primary" disabled={!notesDirty} onClick={() => void saveNotes()}>
                {t('name.save')}
              </Button>
            </div>
            {notesPreview ? (
              <RenderPreview subtype="markdown" output={notes} />
            ) : (
              <textarea
                className="folder-notes__editor"
                value={notes}
                placeholder={t('folder.notes.placeholder')}
                spellCheck={false}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setNotesDirty(true);
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
