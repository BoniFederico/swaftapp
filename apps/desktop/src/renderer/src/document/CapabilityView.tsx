import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserCapabilityDto } from '@swaft/shared';
import { ApiClient, ApiError } from '../api-client/client';
import { CodeEditor } from '../editor/CodeEditor';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/catalogs';
import { Button, SaveIcon, IconButton, useToast } from '../ui';
import { notifyTreeChanged, subscribeTreeChanged } from '../workspace/treeBus';

const DEFAULT_ARGS = '{ "id": "demo" }';

/**
 * Editor for a `capability` template: the JavaScript on the left, a test run on the right.
 *
 * The code is edited in place (like the API view's request) rather than through the Template Editor
 * modal, because for a capability the source *is* the document. The header states the name formulas
 * will call it by — the template's own name — and why it may not be registered, so a clash is
 * visible here instead of surfacing as a puzzling `UNKNOWN_FUNCTION` in some other template.
 */
export function CapabilityView({
  client,
  templateId,
  onDirtyChange,
  onTitleChange,
}: {
  client: ApiClient;
  templateId: string;
  onDirtyChange?: (dirty: boolean) => void;
  onTitleChange?: (name: string) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [source, setSource] = useState('');
  const [savedSource, setSavedSource] = useState<string | null>(null);
  // The parent rebuilds these callbacks on every render; holding them in refs keeps their identity
  // out of the effect dependencies, so a re-render can never restart the load and wipe the editor.
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  const onTitleRef = useRef(onTitleChange);
  onTitleRef.current = onTitleChange;
  const savedSourceRef = useRef<string | null>(null);
  const [capability, setCapability] = useState<UserCapabilityDto | null>(null);
  const [args, setArgs] = useState(DEFAULT_ARGS);
  const [result, setResult] = useState<{ value: unknown; durationMs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const describe = useCallback(() => {
    void client
      .call('usercode.describe', { templateId })
      .then((res) => setCapability(res.capability))
      .catch(() => setCapability(null));
  }, [client, templateId]);

  useEffect(() => {
    let cancelled = false;
    void client.call('template.get', { id: templateId }).then((res) => {
      if (cancelled) return;
      onTitleRef.current?.(res.template.name);
      // Only adopt the stored source when it is genuinely different from what we last saved —
      // never overwrite edits in progress (e.g. after an external save of the same template).
      if (res.template.source === savedSourceRef.current) return;
      savedSourceRef.current = res.template.source;
      setSource(res.template.source);
      setSavedSource(res.template.source);
    });
    describe();
    // A rename changes the capability's name, so re-read the header when the tree moves.
    const unsubscribe = subscribeTreeChanged(describe);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, templateId, describe]);

  const dirty = savedSource !== null && source !== savedSource;
  useEffect(() => onDirtyRef.current?.(dirty), [dirty]);

  const save = useCallback(async () => {
    try {
      await client.call('template.updateSource', { id: templateId, source });
      savedSourceRef.current = source;
      setSavedSource(source);
      notifyTreeChanged();
      describe();
      toast.show(t('toast.saved'), 'success');
    } catch (e) {
      toast.show(e instanceof ApiError ? e.swaft.message : String(e), 'error');
    }
  }, [client, templateId, source, describe, toast, t]);

  // Ctrl/Cmd+S saves — only when this tab is the visible one (tabs stay mounted while hidden).
  const saveRef = useRef(save);
  saveRef.current = save;
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 's' || !(e.ctrlKey || e.metaKey)) return;
      if (rootRef.current?.offsetParent == null) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      void saveRef.current();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  async function trust() {
    try {
      const res = await client.call('usercode.trust', { templateId });
      setCapability(res.capability);
      setError(null);
      toast.show(t('cap.trusted'), 'success');
      notifyTreeChanged();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.swaft.message : String(e), 'error');
    }
  }

  async function run() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(args);
    } catch {
      setError(t('cap.argsInvalid'));
      setResult(null);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setError(t('cap.argsInvalid'));
      setResult(null);
      return;
    }
    setRunning(true);
    setError(null);
    try {
      // Test the code as written: an unsaved draft would otherwise run its last-saved version.
      if (dirty) await save();
      setResult(await client.call('usercode.run', { templateId, args: parsed as Record<string, unknown> }));
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiError ? e.swaft.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const statusKey = capability && capability.status !== 'ok' ? `cap.status.${capability.status}` : null;

  return (
    <div className="doc-view cap-view" ref={rootRef}>
      <header className="cap-view__bar">
        <span className="cap-view__label">{t('cap.registeredAs')}</span>
        <code className="cap-view__name">{capability?.name ?? '—'}</code>
        <span className="cap-view__label">{t('cap.returns')}</span>
        <span className="ui-badge">{capability?.type ?? '—'}</span>
        <span className="cap-view__spacer" />
        <IconButton label={t('name.save')} disabled={!dirty} onClick={() => void save()}>
          <SaveIcon />
        </IconButton>
      </header>

      {statusKey && (
        <div className="auth-error cap-view__problem" role="alert">
          <span>
            {t(statusKey as TranslationKey)}
            {capability?.status !== 'untrusted' && capability?.message ? ` ${capability.message}` : ''}
          </span>
          {/* Approval sits under the code, not in a dialog: the point is to read it first. */}
          {capability?.status === 'untrusted' && (
            <>
              <span className="cap-view__spacer" />
              <Button variant="danger" onClick={() => void trust()}>
                {t('cap.trust')}
              </Button>
            </>
          )}
        </div>
      )}

      <div className="cap-view__body">
        <div className="cap-view__code">
          <CodeEditor language="javascript" value={source} onChange={setSource} />
        </div>

        <aside className="cap-view__panel">
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={`cap-args-${templateId}`}>
              {t('cap.args')}
            </label>
            <textarea
              id={`cap-args-${templateId}`}
              className="ui-input cap-view__args"
              rows={3}
              spellCheck={false}
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
            <span className="field-hint">{t('cap.argsHint')}</span>
          </div>

          {/* Approving is the way forward while untrusted, so Run would only ever fail. */}
          <Button
            variant="primary"
            disabled={running || capability?.status === 'untrusted'}
            onClick={() => void run()}
          >
            {running ? t('cap.running') : t('cap.run')}
          </Button>

          <div className="ui-field">
            <span className="ui-field__label">{t('cap.result')}</span>
            {error ? (
              <div className="auth-error" role="alert">
                {error}
              </div>
            ) : result ? (
              <>
                <pre className="cap-view__result">{JSON.stringify(result.value, null, 2)}</pre>
                <span className="field-hint">{t('cap.tookMs', { n: result.durationMs })}</span>
              </>
            ) : (
              <p className="muted">{t('cap.noResult')}</p>
            )}
          </div>

          {capability?.status === 'ok' && (
            <div className="ui-field">
              <span className="ui-field__label">{t('cap.usage')}</span>
              <code className="cap-view__usage">{`\${ ${capability.name}({ id: 'demo' }) }`}</code>
            </div>
          )}

          {capability?.status === 'untrusted' && (
            <span className="field-hint">{t('cap.reviewFirst')}</span>
          )}

          <span className="field-hint">{t('cap.sandboxNote')}</span>
        </aside>
      </div>
    </div>
  );
}
