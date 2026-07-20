import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SUBTYPE,
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
  FolderIcon,
  IconButton,
  LabelIcon,
  Menu,
  TagIcon,
  useToast,
  type MenuItem,
} from '../ui';
import { CreateProjectDialog } from './CreateProjectDialog';
import { CreateTemplateDialog } from './CreateTemplateDialog';
import { NameDialog } from './NameDialog';
import { ProjectSelector } from './ProjectSelector';
import { badgeColor, rowBadge } from './badges';
import { notifyTreeChanged, subscribeTreeChanged } from './treeBus';
import { useWorkspaceOptional } from './WorkspaceProvider';

type ViewMode = 'tree' | 'tags' | 'type';
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
    default:
      return <DocumentIcon className={className} />;
  }
}

/** A compact segmented control (Tree / Tags / Type) driving how the templates are grouped. */
function ViewModeControl({
  mode,
  onChange,
  labels,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
  labels: Record<ViewMode, string>;
}) {
  const modes: ViewMode[] = ['tree', 'tags', 'type'];
  return (
    <div className="seg" role="tablist" aria-label={labels.tree}>
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={mode === m}
          className={`seg__btn${mode === m ? ' seg__btn--active' : ''}`}
          onClick={() => onChange(m)}
        >
          {labels[m]}
        </button>
      ))}
    </div>
  );
}

/**
 * The Working Tree: project picker + a grouped list of folders/templates. The grouping switches
 * between Tree (nested folders, drag-and-drop), Tags (a section per tag + Untagged) and Type (a
 * section per type, sub-grouped by subtype). Templates open on click (view) / double-click (editor);
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
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [badgeMode, setBadgeMode] = useState<BadgeMode>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(BADGE_MODE_KEY) : null;
    return saved === 'tag' || saved === 'none' ? saved : 'subtype';
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [closedSections, setClosedSections] = useState<Set<string>>(new Set());
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
  const sectionOpen = (key: string) => !closedSections.has(key);
  function toggleSection(key: string) {
    setClosedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // --- drag & drop (Tree view only) ------------------------------------------
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

  // --- selectors -------------------------------------------------------------
  const projectFolderIds = useMemo(
    () => new Set(tree.folders.filter((f) => f.projectId === selectedProject).map((f) => f.id)),
    [tree.folders, selectedProject],
  );
  const childFolders = (parentId: string | null): FolderDto[] =>
    tree.folders.filter(
      (f) => f.projectId === selectedProject && (f.parentFolderId ?? null) === parentId,
    );
  const folderTemplates = (folderId: string): TemplateSummary[] =>
    tree.templates.filter((tpl) => tpl.folderId === folderId);
  const rootTemplates = (): TemplateSummary[] =>
    tree.templates.filter((tpl) => !tpl.folderId && tpl.projectId === selectedProject);
  const projectTemplates = useMemo(
    () =>
      tree.templates.filter(
        (tpl) =>
          (tpl.folderId && projectFolderIds.has(tpl.folderId)) ||
          (!tpl.folderId && tpl.projectId === selectedProject),
      ),
    [tree.templates, projectFolderIds, selectedProject],
  );
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
      badgeMode === 'tag' && viewMode !== 'tags'
        ? tpl.tagIds.map((id) => tagById.get(id)).filter(Boolean)
        : null;
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
    const subfolders = childFolders(folder.id);
    const templates = folderTemplates(folder.id);
    const isOpen = expanded.has(folder.id);
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

  function renderSection(key: string, header: React.ReactNode, templates: TemplateSummary[]) {
    const isOpen = sectionOpen(key);
    return (
      <div key={key}>
        <div
          className="tree-item tree-section"
          onClick={() => toggleSection(key)}
          {...rowKeyProps(() => toggleSection(key))}
        >
          <span className="tree-item__twisty" aria-hidden="true">
            <ChevronIcon className={`tree-twisty${isOpen ? ' tree-twisty--open' : ''}`} />
          </span>
          {header}
          <span className="tree-section__spacer" />
          <span className="tree-section__count">{templates.length}</span>
        </div>
        {isOpen && <div>{templates.map((tpl) => renderTemplate(tpl, 1))}</div>}
      </div>
    );
  }

  function renderTagsView() {
    const sections: React.ReactNode[] = [];
    for (const tag of tree.tags) {
      const templates = projectTemplates.filter((tpl) => tpl.tagIds.includes(tag.id));
      if (templates.length === 0) continue;
      sections.push(
        renderSection(
          `tag:${tag.id}`,
          <span className="tree-tag" style={{ background: tag.color ?? 'var(--primary)' }}>
            {tag.name}
          </span>,
          templates,
        ),
      );
    }
    const untagged = projectTemplates.filter((tpl) => tpl.tagIds.length === 0);
    sections.push(
      renderSection(
        'untagged',
        <span className="tree-section__label">{t('tree.untagged')}</span>,
        untagged,
      ),
    );
    return sections;
  }

  function renderTypeView() {
    const types: TemplateType[] = ['document', 'api', 'capability', 'action'];
    return types.map((type) => {
      const ofType = projectTemplates.filter((tpl) => tpl.type === type);
      if (ofType.length === 0) return null;
      const bySub = new Map<string, TemplateSummary[]>();
      for (const tpl of ofType) {
        // Subtype-less (legacy) templates group under the type's default subtype, not a "—" folder.
        const sub = tpl.subtype ?? DEFAULT_SUBTYPE[type];
        const list = bySub.get(sub) ?? [];
        list.push(tpl);
        bySub.set(sub, list);
      }
      const key = `type:${type}`;
      const isOpen = sectionOpen(key);
      return (
        <div key={key}>
          <div
            className="tree-item tree-section"
            onClick={() => toggleSection(key)}
            {...rowKeyProps(() => toggleSection(key))}
          >
            <span className="tree-item__twisty" aria-hidden="true">
              <ChevronIcon className={`tree-twisty${isOpen ? ' tree-twisty--open' : ''}`} />
            </span>
            <TypeIcon type={type} />
            <span className="tree-section__label">{t(`tpl.${type}`)}</span>
            <span className="tree-section__spacer" />
            <span className="tree-section__count">{ofType.length}</span>
          </div>
          {isOpen && (
            <div>
              {[...bySub.entries()].map(([sub, templates]) => {
                const subKey = `subtype:${type}:${sub}`;
                const subOpen = sectionOpen(subKey);
                return (
                  <div key={subKey}>
                    <div
                      className="tree-item tree-folder"
                      style={{ paddingLeft: 20 }}
                      onClick={() => toggleSection(subKey)}
                      {...rowKeyProps(() => toggleSection(subKey))}
                    >
                      <span className="tree-item__twisty" aria-hidden="true">
                        <ChevronIcon className={`tree-twisty${subOpen ? ' tree-twisty--open' : ''}`} />
                      </span>
                      <FolderIcon className="tree-item__icon tree-item__icon--folder" />
                      <span className="tree-item__name">{sub}</span>
                      <span className="tree-section__count">{templates.length}</span>
                    </div>
                    {subOpen && <div>{templates.map((tpl) => renderTemplate(tpl, 2))}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  }

  const selected = tree.projects.find((p) => p.id === selectedProject) ?? null;
  const roots = childFolders(null);
  const viewLabels: Record<ViewMode, string> = {
    tree: t('tree.viewTree'),
    tags: t('tree.viewTags'),
    type: t('tree.viewType'),
  };

  const dialogTitle =
    dialog?.mode === 'createFolder'
      ? t('tree.createFolder')
      : t('menu.rename');

  return (
    <aside className="tree" aria-label={t('tree.title')}>
      <div className="tree__head">
        <div className="tree__field">
          <span className="ui-field__label">{t('tree.project')}</span>
          <ProjectSelector
            projects={tree.projects}
            selectedId={selectedProject}
            onSelect={(id) => setSelectedProject(id)}
            onCreate={() => setProjectOpen(true)}
            onDelete={(p) => setConfirm({ kind: 'project', id: p.id, name: p.name })}
          />
        </div>
        <IconButton label={t('tree.collapse')} className="tree__collapse" onClick={onCollapse}>
          <ChevronLeftIcon />
        </IconButton>
      </div>

      {selected?.description && <div className="tree__project-desc">{selected.description}</div>}

      {selected && (
        <div className="tree__viewmodes">
          <ViewModeControl mode={viewMode} onChange={setViewMode} labels={viewLabels} />
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
          if (viewMode !== 'tree') return;
          e.preventDefault();
          setDragOver('root');
        }}
        onDragLeave={() => setDragOver((cur) => (cur === 'root' ? null : cur))}
        onDrop={(e) => {
          if (viewMode !== 'tree') return;
          e.preventDefault();
          void dropOn(null);
        }}
      >
        {viewMode === 'tree' && (
          <>
            {roots.map((f) => renderFolder(f, 0))}
            {rootTemplates().map((tpl) => renderTemplate(tpl, 0, true))}
          </>
        )}
        {viewMode === 'tags' && renderTagsView()}
        {viewMode === 'type' && renderTypeView()}
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
