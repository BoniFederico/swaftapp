import { useEffect, useRef, useState } from 'react';
import {
  DRAFT_RELEASE,
  FORMATTABLE_SUBTYPES,
  RENDER_PREVIEW_SUBTYPES,
  SUBTYPES,
  type ChangelogEntryDto,
  type DiagnosticDto,
  type ReleaseDto,
  type TemplateDto,
} from '@swaft/shared';
import { ApiError, type ApiClient } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import {
  Button,
  CloseIcon,
  CodeIcon,
  ConfirmDialog,
  EyeIcon,
  FormatIcon,
  FullscreenIcon,
  HistoryIcon,
  IconButton,
  Select,
  useToast,
} from '../ui';
import { CodeEditor } from '../editor/CodeEditor';
import { formatSource } from '../editor/format';
import { NameDialog } from '../workspace/NameDialog';
import { notifyTreeChanged } from '../workspace/treeBus';
import { ReleasePicker } from './ReleasePicker';
import { RenderPreview } from './RenderPreview';
import { TagEditor } from './TagEditor';

/**
 * Template Editor (redesign) — a full overlay modal. Title bar: editable name + subtype listbox +
 * release listbox + history / fullscreen / close. Editor overlays: a view/code toggle (subtypes with
 * a render) top-right, Save (to the selected release/draft) + New release bottom-right. Selecting a
 * release loads its source and makes it the active selection (drives the rendered output).
 */
export function TemplateEditorModal({
  client,
  templateId,
  onClose,
}: {
  client: ApiClient;
  templateId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [template, setTemplate] = useState<TemplateDto | null>(null);
  const [name, setName] = useState('');
  const [subtype, setSubtype] = useState('');
  const [releases, setReleases] = useState<ReleaseDto[]>([]);
  const [selection, setSelection] = useState<string>(DRAFT_RELEASE);
  const [source, setSource] = useState('');
  const [diagnostics, setDiagnostics] = useState<DiagnosticDto[]>([]);
  const [changelog, setChangelog] = useState<ChangelogEntryDto[]>([]);
  const [viewMode, setViewMode] = useState<'code' | 'view'>('code');
  const [previewOutput, setPreviewOutput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [askName, setAskName] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ReleaseDto | 'draft' | null>(null);
  // The draft's current source/subtype, kept in sync so switching selection restores them.
  const draft = useRef<{ source: string; subtype: string }>({ source: '', subtype: '' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [tpl, rel, sel, log] = await Promise.all([
          client.call('template.get', { id: templateId }),
          client.call('release.list', { templateId }),
          client.call('releaseSelection.get', { templateId }),
          client.call('changelog.list', { templateId }),
        ]);
        if (cancelled) return;
        draft.current = { source: tpl.template.source, subtype: tpl.template.subtype ?? '' };
        setTemplate(tpl.template);
        setName(tpl.template.name);
        setReleases(rel.releases);
        setChangelog(log.entries);
        applySelection(sel.releaseId, rel.releases, tpl.template);
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, templateId]);

  function applySelection(sel: string, rels: ReleaseDto[], tpl: TemplateDto) {
    setSelection(sel);
    if (sel === DRAFT_RELEASE) {
      setSource(draft.current.source);
      setSubtype(draft.current.subtype || (SUBTYPES[tpl.type][0] ?? ''));
    } else {
      const r = rels.find((x) => x.id === sel);
      setSource(r?.source ?? draft.current.source);
      setSubtype(r?.subtype || (SUBTYPES[tpl.type][0] ?? ''));
    }
  }

  // Debounced live diagnostics.
  useEffect(() => {
    const handle = setTimeout(() => {
      void client
        .call('render.validateSource', { source })
        .then((r) => setDiagnostics(r.diagnostics))
        .catch(() => undefined);
    }, 300);
    return () => clearTimeout(handle);
  }, [client, source]);

  const hasRender = RENDER_PREVIEW_SUBTYPES.has(subtype);
  const canFormat = FORMATTABLE_SUBTYPES.has(subtype);
  // Render preview (view mode): render the current source, then wrap by subtype.
  useEffect(() => {
    if (viewMode !== 'view' || !hasRender) return;
    let cancelled = false;
    void client
      .call('render.renderSource', { source, values: {} })
      .then((r) => {
        if (cancelled) return;
        setPreviewOutput(r.result.status === 'completed' ? (r.result.output ?? '') : '');
      })
      .catch(() => setPreviewOutput(''));
    return () => {
      cancelled = true;
    };
  }, [client, viewMode, hasRender, subtype, source]);

  async function selectRelease(sel: string) {
    if (!template) return;
    await client.call('releaseSelection.set', { templateId, releaseId: sel }).catch(() => undefined);
    applySelection(sel, releases, template);
  }

  async function renameTemplate() {
    if (!template || name.trim() === template.name || name.trim() === '') return;
    const res = await client.call('template.rename', { id: templateId, name: name.trim() });
    const updated = res.tree.templates.find((x) => x.id === templateId);
    if (updated) setTemplate({ ...template, name: updated.name });
    notifyTreeChanged();
  }

  async function save() {
    setBusy(true);
    try {
      if (selection === DRAFT_RELEASE) {
        await client.call('template.updateSource', { id: templateId, source, subtype });
      } else {
        await client.call('release.update', { releaseId: selection, source, subtype });
      }
      // On a successful save the editor confirms via a toast and closes.
      notifyTreeChanged();
      toast.show(t('editor.saved'), 'success');
      onClose();
    } catch (e) {
      setBusy(false);
      toast.show(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    try {
      if (target === 'draft') {
        const res = await client.call('template.deleteDraft', { id: templateId });
        setTemplate(res.template);
        if (selection === DRAFT_RELEASE && releases[0]) await selectRelease(releases[0].id);
        toast.show(t('editor.draftDeleted'), 'success');
      } else {
        const res = await client.call('release.delete', { releaseId: target.id });
        setReleases(res.releases);
        if (selection === target.id) {
          await selectRelease(template?.hasDraft ? DRAFT_RELEASE : (res.releases[0]?.id ?? DRAFT_RELEASE));
        }
        toast.show(t('editor.releaseDeleted', { name: target.name }), 'success');
      }
      setChangelog((await client.call('changelog.list', { templateId })).entries);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.swaft.message : String(e), 'error');
    }
  }

  // Ctrl/Cmd+S saves to the selected release/draft, same as the Save button.
  const saveShortcutRef = useRef(() => {});
  saveShortcutRef.current = () => void save();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 's' || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      saveShortcutRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function format() {
    try {
      setSource(await formatSource(subtype, source));
      toast.show(t('editor.formatted'), 'success');
    } catch {
      toast.show(t('editor.formatFailed'), 'error');
    }
  }

  async function createRelease(releaseName: string) {
    setAskName(false);
    setBusy(true);
    try {
      const res = await client.call('release.create', {
        templateId,
        name: releaseName,
        source,
        subtype,
      });
      setReleases(res.releases);
      // Select the new release using the *fresh* list (state isn't updated yet) so its subtype — the
      // one currently selected in the editor — is applied instead of falling back to the default.
      const created = res.releases.find((r) => r.name === releaseName.trim());
      if (created && template) {
        await client
          .call('releaseSelection.set', { templateId, releaseId: created.id })
          .catch(() => undefined);
        applySelection(created.id, res.releases, template);
      }
      setChangelog((await client.call('changelog.list', { templateId })).entries);
    } finally {
      setBusy(false);
    }
  }

  if (!template) return null;
  const subtypeOptions = SUBTYPES[template.type];

  return (
    <div className="editor-overlay" role="dialog" aria-modal="true" aria-label={t('editor.title')}>
      <div className={`editor-modal${full ? ' editor-modal--full' : ''}`}>
        <header className="editor-modal__bar">
          <input
            className="editor-modal__name"
            aria-label={t('editor.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void renameTemplate()}
          />
          <div className="editor-modal__tools">
            {subtypeOptions.length > 1 ? (
              <Select
                aria-label={t('editor.subtype')}
                value={subtype}
                onChange={setSubtype}
                options={subtypeOptions.map((s) => ({ value: s, label: s }))}
              />
            ) : subtypeOptions.length === 1 ? (
              // APIs (and any single-subtype type) are fixed and not changeable.
              <span className="ui-badge" aria-label={t('editor.subtype')}>
                {subtype || subtypeOptions[0]}
              </span>
            ) : null}
            <ReleasePicker
              releases={releases}
              selection={selection}
              draftDate={template.hasDraft ? template.createdAt : null}
              onSelect={(v) => void selectRelease(v)}
              onDelete={(target) => setDeleteTarget(target)}
            />
            <IconButton
              label={t('editor.history')}
              onClick={() => setHistoryOpen((v) => !v)}
            >
              <HistoryIcon />
            </IconButton>
            <IconButton label={t('editor.fullscreen')} onClick={() => setFull((v) => !v)}>
              <FullscreenIcon />
            </IconButton>
            <IconButton label={t('name.cancel')} onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </div>
        </header>

        <div className="editor-modal__tagbar">
          <TagEditor client={client} templateId={templateId} />
          {(hasRender || (viewMode === 'code' && canFormat)) && (
            <div className="editor-modal__tagtools">
              {viewMode === 'code' && canFormat && (
                <IconButton label={t('editor.format')} onClick={() => void format()}>
                  <FormatIcon />
                </IconButton>
              )}
              {hasRender && (
                <IconButton
                  label={viewMode === 'code' ? t('editor.viewRender') : t('editor.viewCode')}
                  onClick={() => setViewMode((m) => (m === 'code' ? 'view' : 'code'))}
                >
                  {viewMode === 'code' ? <EyeIcon /> : <CodeIcon />}
                </IconButton>
              )}
            </div>
          )}
        </div>

        <div className="editor-modal__body">
          <div className="editor-modal__main">
            {viewMode === 'code' ? (
              <div className="editor-modal__code">
                <CodeEditor
                  value={source}
                  language={subtype}
                  onChange={setSource}
                  ariaLabel={t('editor.source')}
                />
              </div>
            ) : (
              <div className="editor-modal__preview">
                <RenderPreview subtype={subtype} output={previewOutput} />
              </div>
            )}

            <div className="editor-overlay-br">
              <Button variant="secondary" onClick={() => setAskName(true)} disabled={busy}>
                {t('editor.newRelease')}
              </Button>
              <Button onClick={() => void save()} disabled={busy}>
                {t('editor.save')}
              </Button>
            </div>

            {viewMode === 'code' && diagnostics.length > 0 && (
              <ul className="diag-list editor-modal__diags">
                {diagnostics.map((d, i) => (
                  <li key={i} className="diag">
                    <span className="diag__code">{d.code}</span> {d.message}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {historyOpen && (
            <aside className="editor-modal__history">
              <div className="editor-modal__history-head">
                <span>{t('editor.changelog')}</span>
                <IconButton label={t('name.cancel')} onClick={() => setHistoryOpen(false)}>
                  <CloseIcon />
                </IconButton>
              </div>
              {changelog.length === 0 ? (
                <span className="muted">{t('wsset.empty')}</span>
              ) : (
                <ul className="changelog-list">
                  {changelog.map((e) => (
                    <li key={e.id} className="changelog-item">
                      <div className="changelog-item__msg">{e.message}</div>
                      <div className="changelog-item__meta muted">
                        {e.username ? `${e.username} · ` : ''}
                        {new Date(e.createdAt).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          )}
        </div>
      </div>

      <NameDialog
        open={askName}
        title={t('editor.newRelease')}
        submitLabel={t('name.create')}
        busy={busy}
        onSubmit={(n) => void createRelease(n)}
        onClose={() => setAskName(false)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget === 'draft' ? t('editor.deleteDraftTitle') : t('editor.deleteReleaseTitle')}
        message={
          deleteTarget === 'draft'
            ? t('editor.confirmDeleteDraft')
            : t('editor.confirmDeleteRelease', { name: deleteTarget?.name ?? '' })
        }
        confirmLabel={t('menu.delete')}
        cancelLabel={t('name.cancel')}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
