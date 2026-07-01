import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DRAFT_RELEASE,
  type ReleaseDto,
  type RenderResultDto,
  type RequirementDto,
  type TemplateDto,
} from '@swaft/shared';
import type { ApiClient } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import { Card, IconButton, SaveIcon, Select, useToast } from '../ui';
import { ActionPanel } from './ActionPanel';
import { InputPanel } from './InputPanel';
import { OutputView } from './OutputView';
import { activeRequirements, compactValues, hasInvalidInputs } from './inputValidation';
import { useDocLayout } from './useDocLayout';
import { subscribeTreeChanged } from '../workspace/treeBus';

/**
 * Document View — the unified template view (document + the former "render" templates). A top bar
 * shows the template name (left) and a release listbox (right); selecting a version reloads its
 * source, re-analyzes its inputs (so the Input container appears/disappears) and re-renders. The
 * Input panel is hidden when the selected version has no inputs. The Output renders the result —
 * rendered for renderable subtypes (html/markdown/eml/mermaid/swagger/echarts), else highlighted
 * code. Rendering is automatic (debounced) on every input change. Source editing lives in the editor.
 */
export function DocumentView({
  client,
  templateId,
  onDirtyChange,
  onTitleChange,
}: {
  client: ApiClient;
  templateId: string;
  /** Report unsaved input-config edits up to the tab bar (it shows a dot). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Report the resolved template name up (so the tab title stays in sync after a rename). */
  onTitleChange?: (name: string) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [template, setTemplate] = useState<TemplateDto | null>(null);
  const [releases, setReleases] = useState<ReleaseDto[]>([]);
  const [selection, setSelection] = useState<string>(DRAFT_RELEASE);
  const [requirements, setRequirements] = useState<RequirementDto[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  // The last-saved input config; `values` differs from it exactly when there are unsaved edits.
  const [savedValues, setSavedValues] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResultDto | null>(null);
  const [busy, setBusy] = useState(false);
  // `error` blocks the panel (the template failed to load); a failed *render* never hides the inputs.
  const [error, setError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const renderRun = useRef(0);
  const docRef = useRef<HTMLDivElement>(null);
  const layout = useDocLayout(projectId ? `swaft:docLayout:${projectId}` : null, docRef);

  // The effective source + subtype of the selected version (draft or a release).
  const current = useMemo(() => {
    if (selection !== DRAFT_RELEASE) {
      const r = releases.find((x) => x.id === selection);
      if (r) return { source: r.source, subtype: r.subtype };
    }
    return { source: template?.source ?? '', subtype: template?.subtype ?? null };
  }, [selection, releases, template]);

  // Load (and reload on external save) the template, releases and persisted selection.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [tpl, rel, sel, state] = await Promise.all([
          client.call('template.get', { id: templateId }),
          client.call('release.list', { templateId }),
          client.call('releaseSelection.get', { templateId }),
          client.call('inputState.get', { templateId }),
        ]);
        if (cancelled) return;
        setTemplate(tpl.template);
        onTitleChange?.(tpl.template.name);
        setReleases(rel.releases);
        setSelection(sel.releaseId);
        setValues(state.values);
        setSavedValues(JSON.stringify(state.values));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void load();
    const unsubscribe = subscribeTreeChanged(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, templateId]);

  // Resolve the owning project (root templates carry it; foldered ones derive it from the folder) so
  // the layout can be persisted per project.
  useEffect(() => {
    if (!template) return;
    if (template.projectId) {
      setProjectId(template.projectId);
      return;
    }
    if (!template.folderId) return;
    let cancelled = false;
    void client
      .call('tree.get')
      .then((r) => {
        const folder = r.tree.folders.find((f) => f.id === template.folderId);
        if (!cancelled) setProjectId(folder?.projectId ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, template]);

  // Re-analyze the selected version's inputs whenever the source changes (selection or save).
  useEffect(() => {
    if (!template) return;
    let cancelled = false;
    renderRun.current += 1;
    setResult(null);
    setRenderError(null);
    void client
      .call('render.analyzeSource', { source: current.source })
      .then((r) => {
        if (!cancelled) setRequirements(r.requirements);
      })
      .catch(() => {
        if (!cancelled) setRequirements([]);
      });
    return () => {
      cancelled = true;
    };
  }, [client, template, current.source]);

  async function selectVersion(sel: string) {
    setSelection(sel);
    await client.call('releaseSelection.set', { templateId, releaseId: sel }).catch(() => undefined);
  }

  // Input config is edited live (the output re-renders on every change) but only persisted on demand,
  // mirroring the API view's explicit Save. The tab shows a dot until the current values are saved.
  const dirty = savedValues !== null && JSON.stringify(values) !== savedValues;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  async function saveInputs() {
    const payload = compactValues(values);
    await client.call('inputState.set', { templateId, values: payload });
    setSavedValues(JSON.stringify(values));
    toast.show(t('doc.inputsSaved'), 'success');
  }

  // Render automatically (debounced) whenever the inputs/version change and inputs are valid. The
  // server renders the active selection (kept in sync via selectVersion), so prepared actions apply.
  useEffect(() => {
    if (!template || hasInvalidInputs(requirements, values)) return;
    const run = renderRun.current;
    const handle = setTimeout(() => {
      setBusy(true);
      void client
        .call('template.render', { id: templateId, values: compactValues(values) })
        .then((res) => {
          if (run !== renderRun.current) return;
          setResult(res.result);
          setRenderError(null);
        })
        .catch((e) => {
          if (run === renderRun.current) setRenderError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => setBusy(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [client, templateId, template, requirements, values, selection]);

  // Cache the best-known options per requirement. Dynamic choices (a capability's `args.candidates`,
  // e.g. a multiOption whose options depend on another input) are only resolved on the render's
  // `pending`, so cache them to keep a *filled* dependent input's options available too.
  const optionsCache = useRef<Map<string, string[]>>(new Map());
  useEffect(() => {
    if (!result) return;
    for (const p of result.pending) if (p.options) optionsCache.current.set(p.id, p.options);
  }, [result]);

  // Show only the inputs the lazy render actually reaches (hide needs gated behind an untaken branch;
  // reveal them progressively), with their resolved (possibly dynamic) options. The render guard
  // still uses the full static set.
  const active = useMemo(() => {
    const reached = activeRequirements(requirements, result);
    const live = new Map((result?.pending ?? []).map((p) => [p.id, p.options] as const));
    return reached.map((r) => {
      const opts = live.get(r.id) ?? optionsCache.current.get(r.id) ?? r.options;
      return opts === r.options ? r : { ...r, options: opts ?? null };
    });
  }, [requirements, result]);
  const showPanel = !template || !!error || active.length > 0;

  return (
    <div className="render-view">
      <div className="render-view__bar">
        <span className="render-view__name">{template?.name ?? ''}</span>
        <Select
          aria-label={t('render.version')}
          value={selection}
          onChange={(v) => void selectVersion(v)}
          options={[
            { value: DRAFT_RELEASE, label: t('editor.draft') },
            ...releases.map((r) => ({ value: r.id, label: r.name })),
          ]}
        />
      </div>

      <div className="doc" ref={docRef} style={{ height: layout.height ?? undefined }}>
        {/* Hide the Input container entirely when the selected version has no inputs. */}
        {showPanel && (
          <>
            <div className="doc__panel" style={{ width: layout.panelWidth }}>
              <Card
                title={t('doc.inputs')}
                actions={
                  template && !error ? (
                    <IconButton
                      label={t('doc.saveInputs')}
                      className={dirty ? 'doc__save doc__save--dirty' : 'doc__save'}
                      onClick={() => void saveInputs()}
                    >
                      <SaveIcon />
                    </IconButton>
                  ) : undefined
                }
              >
                {error ? (
                  <div className="auth-error" role="alert">
                    {error}
                  </div>
                ) : !template ? (
                  <span className="muted">{t('doc.loading')}</span>
                ) : (
                  <InputPanel
                    requirements={active}
                    values={values}
                    onChange={(id, value) => setValues((v) => ({ ...v, [id]: value }))}
                  />
                )}
              </Card>
            </div>

            <div
              className="doc__hsplit"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('doc.resizeH')}
              onPointerDown={layout.onHResize}
            />
          </>
        )}

        <div className="doc__output">
          <OutputView
            result={result}
            error={renderError}
            busy={busy}
            fileBaseName={template?.name ?? 'output'}
            subtype={current.subtype}
          />
          {result && result.actions.length > 0 && (
            <ActionPanel client={client} templateId={templateId} actions={result.actions} />
          )}
        </div>

        <div
          className="doc__vsplit"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('doc.resizeV')}
          onPointerDown={layout.onVResize}
        />
      </div>
    </div>
  );
}
