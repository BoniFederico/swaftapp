import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type FolderDto,
  type OpName,
  type TagDto,
  type TemplateSummary,
  type TemplateType,
  type WorkspaceTree,
} from '@swaft/shared';
import { ApiClient, ApiError } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import {
  ApiIcon,
  CapabilityIcon,
  Button,
  ChevronIcon,
  ChevronLeftIcon,
  ConfirmDialog,
  DocumentIcon,
  EmptyIcon,
  FilterIcon,
  FolderIcon,
  IconButton,
  LabelIcon,
  Menu,
  ScenarioIcon,
  SearchIcon,
  TagIcon,
  useToast,
  type MenuItem,
} from '../ui';
import { usePopover } from '../ui/usePopover';
import { CreateProjectDialog } from './CreateProjectDialog';
import { CreateTemplateDialog } from './CreateTemplateDialog';
import { NameDialog } from './NameDialog';
import { ProjectSelector } from './ProjectSelector';
import { badgeColor, rowBadge } from './badges';
import { notifyTreeChanged, subscribeTreeChanged } from './treeBus';
import { useWorkspaceOptional } from './WorkspaceProvider';

/** What the per-row trailing chip shows: subtype badges, tag dots, or nothing (3-state cycle). */
type BadgeMode = 'subtype' | 'tag' | 'none';
const BADGE_MODE_KEY = 'swaft:badgeMode';
const nextBadgeMode = (m: BadgeMode): BadgeMode =>
  m === 'subtype' ? 'tag' : m === 'tag' ? 'none' : 'subtype';
type DialogState =
  | { mode: 'createFolder'; parentFolderId: string | null }
  | { mode: 'renameFolder'; id: string; value: string }
  | { mode: 'renameTemplate'; id: string; value: string };
type ConfirmState = { kind: 'project' | 'folder' | 'template'; id: string; name: string };
type DragItem = { kind: 'folder' | 'template'; id: string };

const EMPTY: WorkspaceTree = { projects: [], folders: [], tags: [], templates: [] };

/** The left-hand icon for a template, by type — colored so the types read at a glance. */
function TypeIcon({ type }: { type: TemplateType }) {
  const className = `tree-item__icon tree-item__icon--${type}`;
  switch (type) {
    case 'api':
      return <ApiIcon className={className} />;
    case 'capability':
    case 'action':
      return <CapabilityIcon className={className} />;
    case 'scenario':
      return <ScenarioIcon className={className} />;
    default:
      return <DocumentIcon className={className} />;
  }
}

/** Funnel button filtering the tree to one template type; its menu offers All + the four types. */
function TypeFilterButton({
  value,
  onChange,
}: {
  value: TemplateType | null;
  onChange: (type: TemplateType | null) => void;
}) {
  const { t } = useI18n();
  const { open, setOpen, pos, triggerRef, popRef, toggle } = usePopover<HTMLUListElement>();
  const options: { type: TemplateType | null; label: string }[] = [
    { type: null, label: t('tree.filterAll') },
    { type: 'document', label: t('tpl.document') },
    { type: 'api', label: t('tpl.api') },
    { type: 'capability', label: t('tpl.capability') },
    { type: 'action', label: t('tpl.action') },
    { type: 'scenario', label: t('tpl.scenario') },
  ];
  return (
    <>
      <IconButton
        ref={triggerRef}
        label={t('tree.filter')}
        className="tree__filter"
        data-active={value !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <FilterIcon />
      </IconButton>
      {open &&
        createPortal(
          <ul
            ref={popRef}
            role="menu"
            className="ui-menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
          >
            {options.map((opt) => (
              <li key={opt.type ?? 'all'} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === opt.type}
                  className={`ui-menu__item${value === opt.type ? ' ui-menu__item--active' : ''}`}
                  onClick={() => {
                    setOpen(false);
                    onChange(opt.type);
                  }}
                >
                  {opt.type && <TypeIcon type={opt.type} />}
                  {opt.label}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}

/**
 * The Working Tree: project picker + the nested folder/template tree (drag-and-drop). A search box
 * narrows it to templates whose name or content matches (folders auto-expand around the hits), and a
 * funnel button filters by template type. Templates open on click (view) / double-click (editor);
 * folders expand on click. Destructive actions confirm and report via toast.
 */
export function WorkingTree({
  client,
  openTemplateId,
  onOpenTemplate,
  onOpenFolder,
  onCloseTemplate,
  onCollapse,
}: {
  client: ApiClient;
  openTemplateId: string | null;
  onOpenTemplate: (
    id: string | null,
    mode?: 'view' | 'edit' | 'pin',
    type?: TemplateType,
    name?: string,
  ) => void;
  /** Open the folder detail view (Content / Headers / Proxy / Notes) in a tab. */
  onOpenFolder?: (folder: FolderDto) => void;
  onCloseTemplate?: (id: string) => void;
  onCollapse: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const workspace = useWorkspaceOptional();
  const projectKey = workspace?.current?.path
    ? `swaft:lastProject:${workspace.current.path}`
    : null;
  const [tree, setTree] = useState<WorkspaceTree>(EMPTY);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [badgeMode, setBadgeMode] = useState<BadgeMode>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(BADGE_MODE_KEY) : null;
    return saved === 'tag' || saved === 'none' ? saved : 'subtype';
  });
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TemplateType | null>(null);
  /** Ids matching the text search (name or content), or null when no text search is active. */
  const [matchIds, setMatchIds] = useState<Set<string> | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [projectOpen, setProjectOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [createTpl, setCreateTpl] = useState<{ folderId: string | null } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const dragItem = useRef<DragItem | null>(null);

  // Load the tree, restore the last-selected project for this workspace, and keep the tree in sync
  // with mutations made elsewhere (e.g. the Template Editor changing tags/subtype) in real time.
  useEffect(() => {
    let cancelled = false;
    async function reload() {
      try {
        const next = (await client.call('tree.get')).tree;
        if (!cancelled) setTree(next);
        return next;
      } catch {
        if (!cancelled) setTree(EMPTY);
        return EMPTY;
      }
    }
    void (async () => {
      const next = await reload();
      if (cancelled) return;
      const saved = projectKey ? localStorage.getItem(projectKey) : null;
      if (saved && next.projects.some((p) => p.id === saved)) setSelectedProject(saved);
      setRestored(true);
    })();
    const unsubscribe = subscribeTreeChanged(() => void reload());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, projectKey]);

  // Persist the active project per workspace so it is reselected on the next open.
  useEffect(() => {
    if (!restored || !projectKey) return;
    if (selectedProject) localStorage.setItem(projectKey, selectedProject);
    else localStorage.removeItem(projectKey);
  }, [restored, projectKey, selectedProject]);

  // Debounced free-text search over names + contents. Content (draft/release sources) lives only in
  // the backend — the tree carries summaries — so matching ids come from `template.search`. Re-runs
  // when the tree changes so results track mutations made while a search is active.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setMatchIds(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void client
        .call('template.search', { query: q })
        .then((res) => {
          if (!cancelled) setMatchIds(new Set(res.ids));
        })
        .catch(() => {
          if (!cancelled) setMatchIds(new Set());
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, query, tree]);

  // Persist the last row-badge choice (global, across workspaces).
  function cycleBadgeMode() {
    setBadgeMode((m) => {
      const next = nextBadgeMode(m);
      try {
        localStorage.setItem(BADGE_MODE_KEY, next);
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }

  async function run(op: OpName, payload: Record<string, unknown>): Promise<WorkspaceTree> {
    setBusy(true);
    try {
      const res = await client.call(op as 'tree.get', payload as never);
      const next = (res as { tree: WorkspaceTree }).tree;
      setTree(next);
      // Broadcast so open views over tree entities (e.g. a folder tab) reflect the mutation live.
      notifyTreeChanged();
      return next;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Run a tree mutation whose callers `void` the promise, surfacing any failure as a toast instead
   * of a silent no-op — e.g. creating an action with a name that is not a valid identifier.
   */
  async function guarded(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.swaft.message : String(e), 'error');
    }
  }

  async function createProject(name: string, description: string) {
    setProjectOpen(false);
    const before = new Set(tree.projects.map((p) => p.id));
    const next = await run('project.create', { name, description: description || undefined });
    const created = next.projects.find((p) => !before.has(p.id));
    if (created) setSelectedProject(created.id);
  }

  async function submitDialog(name: string) {
    const d = dialog;
    setDialog(null);
    if (!d) return;
    if (d.mode === 'createFolder') {
      if (!selectedProject) return;
      await run('folder.create', {
        name,
        projectId: selectedProject,
        parentFolderId: d.parentFolderId,
      });
      if (d.parentFolderId) expand(d.parentFolderId);
    } else if (d.mode === 'renameFolder') {
      await run('folder.rename', { id: d.id, name });
    } else {
      await run('template.rename', { id: d.id, name });
    }
  }

  async function createTemplate(name: string, type: TemplateType) {
    const target = createTpl;
    setCreateTpl(null);
    if (!target || !selectedProject) return;
    const before = new Set(tree.templates.map((tpl) => tpl.id));
    const payload = target.folderId
      ? { folderId: target.folderId, name, type }
      : { projectId: selectedProject, name, type };
    const next = await run('template.create', payload);
    if (target.folderId) expand(target.folderId);
    const created = next.templates.find((tpl) => !before.has(tpl.id));
    if (created) onOpenTemplate(created.id, 'view', created.type, created.name);
  }

  async function onConfirm() {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    try {
      if (c.kind === 'project') {
        await run('project.delete', { id: c.id });
        if (selectedProject === c.id) setSelectedProject(null);
        toast.show(t('toast.projectDeleted', { name: c.name }), 'success');
      } else if (c.kind === 'folder') {
        await run('folder.delete', { id: c.id });
        onCloseTemplate?.(c.id); // close the folder's own tab if it was open
        toast.show(t('toast.folderDeleted', { name: c.name }), 'success');
      } else {
        await run('template.delete', { id: c.id });
        onCloseTemplate?.(c.id);
        toast.show(t('toast.templateDeleted', { name: c.name }), 'success');
      }
    } catch (e) {
      toast.show(e instanceof ApiError ? e.swaft.message : String(e), 'error');
    }
  }

  /** Double-click behavior is a preference: pin the tab (classic) or open the editor (default). */
  async function openOnDoubleClick(tpl: TemplateSummary) {
    const prefs = await client.call('prefs.get').catch(() => null);
    const mode = prefs?.preferences.treeDoubleClick === 'pin' ? 'pin' : 'edit';
    onOpenTemplate(tpl.id, mode, tpl.type, tpl.name);
  }

  function expand(id: string) {
    setExpanded((prev) => new Set(prev).add(id));
  }
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  // --- drag & drop -----------------------------------------------------------
  async function dropOn(targetFolderId: string | null) {
    const item = dragItem.current;
    dragItem.current = null;
    setDragOver(null);
    if (!item) return;
    if (item.kind === 'template') {
      await run('template.move', {
        templateId: item.id,
        folderId: targetFolderId,
        projectId: targetFolderId ? undefined : selectedProject,
      }).catch(() => undefined);
      return;
    }
    if (item.id === targetFolderId) return;
    await run('folder.move', { folderId: item.id, parentFolderId: targetFolderId }).catch(
      () => undefined,
    );
    if (targetFolderId) expand(targetFolderId);
  }

  // --- selectors (search + type filter applied) ------------------------------
  const filterActive = matchIds !== null || typeFilter !== null;
  const matchesFilters = (tpl: TemplateSummary): boolean =>
    (matchIds === null || matchIds.has(tpl.id)) && (typeFilter === null || tpl.type === typeFilter);

  const projectFolderIds = useMemo(
    () => new Set(tree.folders.filter((f) => f.projectId === selectedProject).map((f) => f.id)),
    [tree.folders, selectedProject],
  );
  const childFolders = (parentId: string | null): FolderDto[] =>
    tree.folders.filter(
      (f) => f.projectId === selectedProject && (f.parentFolderId ?? null) === parentId,
    );
  const folderTemplates = (folderId: string): TemplateSummary[] =>
    tree.templates.filter((tpl) => tpl.folderId === folderId && matchesFilters(tpl));
  const rootTemplates = (): TemplateSummary[] =>
    tree.templates.filter(
      (tpl) => !tpl.folderId && tpl.projectId === selectedProject && matchesFilters(tpl),
    );
  const projectTemplates = useMemo(
    () =>
      tree.templates.filter(
        (tpl) =>
          (tpl.folderId && projectFolderIds.has(tpl.folderId)) ||
          (!tpl.folderId && tpl.projectId === selectedProject),
      ),
    [tree.templates, projectFolderIds, selectedProject],
  );
  /** Whether a folder's subtree keeps any template under the active search/type filters. */
  const subtreeHasMatches = (folderId: string): boolean =>
    folderTemplates(folderId).length > 0 ||
    childFolders(folderId).some((f) => subtreeHasMatches(f.id));
  const tagById = useMemo(() => new Map(tree.tags.map((t) => [t.id, t])), [tree.tags]);

  // --- row renderers ---------------------------------------------------------
  function templateMenu(tpl: TemplateSummary): MenuItem[] {
    return [
      { label: t('menu.edit'), onSelect: () => onOpenTemplate(tpl.id, 'edit', tpl.type, tpl.name) },
      {
        label: t('menu.rename'),
        onSelect: () => setDialog({ mode: 'renameTemplate', id: tpl.id, value: tpl.name }),
      },
      {
        label: t('menu.delete'),
        danger: true,
        onSelect: () => setConfirm({ kind: 'template', id: tpl.id, name: tpl.name }),
      },
    ];
  }

  /** Keyboard equivalence for clickable rows: Enter/Space activate like a click (WCAG 2.1.1). */
  function rowKeyProps(activate: () => void) {
    return {
      tabIndex: 0,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      },
    };
  }

  function renderTemplate(tpl: TemplateSummary, depth: number, draggable = false) {
    const badge = badgeMode === 'subtype' ? rowBadge(tpl) : null;
    const tags =
      badgeMode === 'tag' ? tpl.tagIds.map((id) => tagById.get(id)).filter(Boolean) : null;
    return (
      <div
        key={`tpl-${tpl.id}`}
        className="tree-item tree-template"
        style={{ paddingLeft: 12 + depth * 16 }}
        data-active={tpl.id === openTemplateId}
        draggable={draggable}
        onDragStart={(e) => {
          dragItem.current = { kind: 'template', id: tpl.id };
          // Carry the template across components (e.g. dropping into the Batcher panel).
          e.dataTransfer?.setData(
            'application/swaft-template',
            JSON.stringify({ id: tpl.id, name: tpl.name, type: tpl.type }),
          );
        }}
        onClick={() => onOpenTemplate(tpl.id, 'view', tpl.type, tpl.name)}
        onDoubleClick={() => void openOnDoubleClick(tpl)}
        {...rowKeyProps(() => onOpenTemplate(tpl.id, 'view', tpl.type, tpl.name))}
      >
        <span className="tree-item__spacer" />
        <TypeIcon type={tpl.type} />
        <span className="tree-item__name">{tpl.name}</span>
        {tags && tags.length > 0 && (
          <span className="tree-item__tags">
            {(tags as TagDto[]).map((tag) => (
              <span
                key={tag.id}
                className="tree-tagdot"
                style={{ background: tag.color ?? 'var(--primary)' }}
                title={tag.name}
              />
            ))}
          </span>
        )}
        {badge && (
          <span
            className="tree-badge"
            style={{ color: badgeColor(badge), borderColor: badgeColor(badge) }}
          >
            {badge}
          </span>
        )}
        <span className="tree-item__menu" onClick={(e) => e.stopPropagation()}>
          <Menu label={`${tpl.name} actions`} items={templateMenu(tpl)} />
        </span>
      </div>
    );
  }

  function renderFolder(folder: FolderDto, depth: number) {
    // Under an active search/type filter, folders with no surviving templates disappear and the
    // rest auto-expand so the hits are visible in place.
    if (filterActive && !subtreeHasMatches(folder.id)) return null;
    const subfolders = childFolders(folder.id);
    const templates = folderTemplates(folder.id);
    const isOpen = filterActive || expanded.has(folder.id);
    const hasChildren = subfolders.length > 0 || templates.length > 0;
    const items: MenuItem[] = [
      {
        label: t('menu.newSubfolder'),
        onSelect: () => setDialog({ mode: 'createFolder', parentFolderId: folder.id }),
      },
      { label: t('menu.newTemplate'), onSelect: () => setCreateTpl({ folderId: folder.id }) },
      {
        label: t('menu.rename'),
        onSelect: () => setDialog({ mode: 'renameFolder', id: folder.id, value: folder.name }),
      },
      {
        label: t('menu.delete'),
        danger: true,
        onSelect: () => setConfirm({ kind: 'folder', id: folder.id, name: folder.name }),
      },
    ];
    return (
      <div key={`folder-${folder.id}`}>
        <div
          className="tree-item tree-folder"
          style={{ paddingLeft: 4 + depth * 16 }}
          data-active={folder.id === openTemplateId}
          data-dragover={dragOver === folder.id}
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            dragItem.current = { kind: 'folder', id: folder.id };
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(folder.id);
          }}
          onDragLeave={() => setDragOver((cur) => (cur === folder.id ? null : cur))}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void dropOn(folder.id);
          }}
          onClick={() => {
            // A click both expands/collapses the folder and opens its detail tab.
            toggle(folder.id);
            onOpenFolder?.(folder);
          }}
          {...rowKeyProps(() => {
            toggle(folder.id);
            onOpenFolder?.(folder);
          })}
        >
          {hasChildren ? (
            <span className="tree-item__twisty" aria-hidden="true">
              <ChevronIcon className={`tree-twisty${isOpen ? ' tree-twisty--open' : ''}`} />
            </span>
          ) : (
            <span className="tree-item__spacer" />
          )}
          <FolderIcon className="tree-item__icon tree-item__icon--folder" />
          <span className="tree-item__name">{folder.name}</span>
          <span className="tree-item__menu" onClick={(e) => e.stopPropagation()}>
            <Menu label={`${folder.name} actions`} items={items} />
          </span>
        </div>
        {isOpen && (
          <div>
            {subfolders.map((f) => renderFolder(f, depth + 1))}
            {templates.map((tpl) => renderTemplate(tpl, depth + 1, true))}
          </div>
        )}
      </div>
    );
  }

  const selected = tree.projects.find((p) => p.id === selectedProject) ?? null;
  const roots = childFolders(null);

  const dialogTitle =
    dialog?.mode === 'createFolder'
      ? t('tree.createFolder')
      : t('menu.rename');

  return (
    <aside className="tree" aria-label={t('tree.title')}>
      <div className="tree__head">
        <div className="tree__field">
          <div className="tree__field-head">
            <span className="ui-field__label">{t('tree.project')}</span>
            <IconButton label={t('tree.collapse')} className="tree__collapse" onClick={onCollapse}>
              <ChevronLeftIcon />
            </IconButton>
          </div>
          <ProjectSelector
            projects={tree.projects}
            selectedId={selectedProject}
            onSelect={(id) => setSelectedProject(id)}
            onCreate={() => setProjectOpen(true)}
            onDelete={(p) => setConfirm({ kind: 'project', id: p.id, name: p.name })}
          />
        </div>
      </div>

      {selected?.description && <div className="tree__project-desc">{selected.description}</div>}

      {selected && (
        <div className="tree__searchbar">
          <div className="tree-search">
            <SearchIcon className="tree-search__icon" />
            <input
              type="search"
              className="tree-search__input"
              placeholder={t('tree.searchPlaceholder')}
              aria-label={t('tree.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <TypeFilterButton value={typeFilter} onChange={setTypeFilter} />
          <IconButton
            label={t(`tree.badge.${badgeMode}`)}
            className="tree__badgetoggle"
            onClick={cycleBadgeMode}
          >
            {badgeMode === 'subtype' ? (
              <TagIcon />
            ) : badgeMode === 'tag' ? (
              <EmptyIcon />
            ) : (
              <LabelIcon />
            )}
          </IconButton>
        </div>
      )}

      {selected && (
        <div className="tree__actions">
          <Button
            variant="secondary"
            className="tree-action tree-action--dashed"
            onClick={() => setCreateTpl({ folderId: null })}
          >
            {t('tree.createTemplate')}
          </Button>
          <Button
            variant="secondary"
            className="tree-action tree-action--dashed"
            onClick={() => setDialog({ mode: 'createFolder', parentFolderId: null })}
          >
            {t('tree.createFolder')}
          </Button>
        </div>
      )}

      {selected && <div className="tree__label">{t('tree.title')}</div>}

      <div
        className="tree__body"
        data-dragover={dragOver === 'root'}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver('root');
        }}
        onDragLeave={() => setDragOver((cur) => (cur === 'root' ? null : cur))}
        onDrop={(e) => {
          e.preventDefault();
          void dropOn(null);
        }}
      >
        {roots.map((f) => renderFolder(f, 0))}
        {rootTemplates().map((tpl) => renderTemplate(tpl, 0, true))}
        {filterActive && !projectTemplates.some(matchesFilters) && (
          <div className="tree__noresults">{t('tree.noResults')}</div>
        )}
      </div>

      <CreateProjectDialog
        open={projectOpen}
        busy={busy}
        onSubmit={(name, description) => void guarded(() => createProject(name, description))}
        onClose={() => setProjectOpen(false)}
      />

      <NameDialog
        open={dialog !== null}
        title={dialogTitle}
        submitLabel={dialog?.mode.startsWith('rename') ? t('name.save') : t('name.create')}
        initialValue={dialog && 'value' in dialog ? dialog.value : ''}
        busy={busy}
        onSubmit={(name) => void guarded(() => submitDialog(name))}
        onClose={() => setDialog(null)}
      />

      <CreateTemplateDialog
        open={createTpl !== null}
        busy={busy}
        onSubmit={(name, type) => void guarded(() => createTemplate(name, type))}
        onClose={() => setCreateTpl(null)}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={t('confirm.title')}
        message={
          confirm?.kind === 'project'
            ? t('confirm.deleteProject', { name: confirm.name })
            : confirm?.kind === 'folder'
              ? t('confirm.deleteFolder', { name: confirm.name })
              : t('confirm.deleteTemplate', { name: confirm?.name ?? '' })
        }
        confirmLabel={t('menu.delete')}
        cancelLabel={t('name.cancel')}
        onConfirm={() => void onConfirm()}
        onClose={() => setConfirm(null)}
      />
    </aside>
  );
}
