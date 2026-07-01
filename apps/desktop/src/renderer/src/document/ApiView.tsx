import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApiHistoryItem,
  DiagnosticDto,
  HttpBodyType,
  HttpMethod,
  HttpRequestModel,
  HttpResponseDto,
  RequirementDto,
} from '@swaft/shared';
import { ApiClient, ApiError } from '../api-client/client';
import { CodeEditor } from '../editor/CodeEditor';
import { formatSource } from '../editor/format';
import { SeeboField } from '../editor/SeeboField';
import { seeboFormulaCompletionSource } from '../editor/seebo-cm';
import { useI18n } from '../i18n/I18nProvider';
import {
  Button,
  CloseIcon,
  CopyIcon,
  FormatIcon,
  IconButton,
  SaveIcon,
  Select,
  TextField,
  useToast,
} from '../ui';
import { notifyTreeChanged, subscribeTreeChanged } from '../workspace/treeBus';
import { InputPanel } from './InputPanel';
import { compactValues } from './inputValidation';
import { KeyValueEditor } from './KeyValueEditor';
import { RenderPreview } from './RenderPreview';
import { useDocLayout } from './useDocLayout';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
type ReqTab = 'params' | 'headers' | 'body' | 'auth' | 'info' | 'input';
type ResTab = 'render' | 'body' | 'headers' | 'history';

const CONTENT_TYPE: Record<HttpBodyType, string | null> = {
  none: null,
  json: 'application/json',
  form: 'application/x-www-form-urlencoded',
  text: 'text/plain',
  xml: 'application/xml',
};
/** CodeMirror language for a body type (xml falls back to the html grammar). */
function bodyLanguage(type: HttpBodyType): string | null {
  if (type === 'json') return 'json';
  if (type === 'xml') return 'html';
  return null;
}

function parseRequest(source: string): HttpRequestModel {
  try {
    const r = JSON.parse(source) as Partial<HttpRequestModel>;
    if (r && typeof r === 'object' && r.method && r.url !== undefined) {
      // The query lives in the URL (single source of truth) — drop any redundant `query` field so it
      // is never double-appended to the request at send time.
      const model = { ...r } as HttpRequestModel;
      delete model.query;
      return model;
    }
  } catch {
    /* fall through */
  }
  return { method: 'GET', url: '' };
}

/**
 * Split a URL into its base and its **raw** query params; rebuild it from a base + params. Values are
 * kept verbatim (no percent-encoding) so the URL bar / Params tab show exactly what the user typed;
 * the real encoding happens invisibly at send time (`new URL(...)` in the HTTP client).
 */
function splitUrl(url: string): { base: string; query: Record<string, string> } {
  const qi = url.indexOf('?');
  if (qi === -1) return { base: url, query: {} };
  const query: Record<string, string> = {};
  for (const pair of url.slice(qi + 1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = eq === -1 ? pair : pair.slice(0, eq);
    if (k) query[k] = eq === -1 ? '' : pair.slice(eq + 1);
  }
  return { base: url.slice(0, qi), query };
}
function buildUrl(base: string, query: Record<string, string>): string {
  const keys = Object.keys(query).filter((k) => k);
  if (keys.length === 0) return base;
  const qs = keys.map((k) => `${k}=${query[k] ?? ''}`).join('&');
  return `${base}?${qs}`;
}

function statusKind(status: number | null): 'ok' | 'warn' | 'err' {
  if (status == null) return 'warn';
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 400) return 'err';
  return 'warn';
}
function shortTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}

/**
 * API View (M8, redesign) — a Postman/Bruno-style request builder. Template-name bar on top, then a
 * method + URL bar (URL query stays in sync with the Params tab), request tabs (params / headers /
 * body / auth / information) and response tabs (body / headers / history). Bodies are highlighted by
 * type; the response is auto-formatted. History is metadata-only (never bodies — security model).
 */
export function ApiView({
  client,
  templateId,
  onDirtyChange,
  onTitleChange,
}: {
  client: ApiClient;
  templateId: string;
  /** Report unsaved edits up to the tab bar (it shows a dot). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Report the resolved template name up (so the tab title stays in sync after a rename). */
  onTitleChange?: (name: string) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.show(t('doc.copied'), 'success'),
      () => toast.show(t('doc.copyFailed'), 'error'),
    );
  };
  // The last-persisted serialized request; `req` differs from it exactly when there are unsaved edits.
  // A ref mirrors it so the tree-change reload can tell an external save from the echo of our own save.
  const [savedSource, setSavedSource] = useState<string | null>(null);
  const savedSourceRef = useRef<string | null>(null);
  const [req, setReq] = useState<HttpRequestModel>({ method: 'GET', url: '' });
  const [response, setResponse] = useState<HttpResponseDto | null>(null);
  // The concrete (rendered) request that was sent, when the request used `${ … }` formulas.
  const [renderedReq, setRenderedReq] = useState<HttpRequestModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ApiHistoryItem[]>([]);
  const [detail, setDetail] = useState<ApiHistoryItem | null>(null);
  const [refs, setRefs] = useState<string[]>([]);
  const [secretRef, setSecretRef] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [reqTab, setReqTab] = useState<ReqTab>('params');
  const [resTab, setResTab] = useState<ResTab>('body');
  const [projectId, setProjectId] = useState<string | null>(null);
  // The input widgets the request's `${ … }` formulas need (live `api.analyze`) + their last values.
  const [requirements, setRequirements] = useState<RequirementDto[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [diags, setDiags] = useState<DiagnosticDto[]>([]);
  const analyzeRun = useRef(0);
  // Best-known options per input id, so a *filled* dependent input keeps its dynamic choices.
  const optionsCache = useRef<Map<string, string[]>>(new Map());
  const colsRef = useRef<HTMLDivElement>(null);
  const layout = useDocLayout(projectId ? `swaft:apiLayout:${projectId}` : null, colsRef, {
    defaultPanelWidth: 520,
  });

  useEffect(() => {
    let cancelled = false;
    const applySaved = (source: string) => {
      savedSourceRef.current = source;
      setSavedSource(source);
    };
    // Reflect an EXTERNAL change to the template source (e.g. edited + saved in the Template Editor):
    // re-parse it into the structured request. Skips the echo of our own save (source === saved).
    async function reloadSource() {
      try {
        const res = await client.call('template.get', { id: templateId });
        if (cancelled) return;
        onTitleChange?.(res.template.name);
        const parsed = parseRequest(res.template.source);
        const source = JSON.stringify(parsed);
        if (source === savedSourceRef.current) return;
        setReq(parsed);
        applySaved(source);
      } catch {
        /* best-effort */
      }
    }
    void (async () => {
      try {
        const [tpl, hist, sec, inp] = await Promise.all([
          client.call('template.get', { id: templateId }),
          client.call('api.history.list', { templateId }),
          client.call('secret.list'),
          client.call('inputState.get', { templateId }),
        ]);
        if (cancelled) return;
        onTitleChange?.(tpl.template.name);
        const parsed = parseRequest(tpl.template.source);
        setReq(parsed);
        applySaved(JSON.stringify(parsed));
        setHistory(hist.items);
        setRefs(sec.refs);
        setValues(inp.values);
        const tm = tpl.template;
        if (tm.projectId) setProjectId(tm.projectId);
        else if (tm.folderId) {
          const tree = await client.call('tree.get');
          if (cancelled) return;
          setProjectId(tree.tree.folders.find((f) => f.id === tm.folderId)?.projectId ?? null);
        }
      } catch {
        /* best-effort */
      }
    })();
    const unsubscribe = subscribeTreeChanged(() => void reloadSource());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, templateId]);

  function patch(p: Partial<HttpRequestModel>) {
    setReq((r) => ({ ...r, ...p }));
  }
  // URL ↔ Params: the URL is the single source of truth; the Params tab is derived from it (see the
  // `query` prop below), so editing either side reflects in the other. Values stay raw here — encoding
  // is applied invisibly at send time.
  function setUrl(url: string) {
    patch({ url });
  }
  function setParams(query: Record<string, string>) {
    patch({ url: buildUrl(splitUrl(req.url).base, query) });
  }
  const bodyType: HttpBodyType = req.bodyType ?? (req.body ? 'text' : 'none');
  function setBodyType(type: HttpBodyType) {
    const headers = { ...(req.headers ?? {}) };
    const ct = CONTENT_TYPE[type];
    if (ct) headers['Content-Type'] = ct;
    patch({ bodyType: type, body: type === 'none' ? null : (req.body ?? ''), headers });
  }
  async function formatBody() {
    if (!req.body) return;
    try {
      patch({ body: await formatSource('json', req.body) });
    } catch {
      /* leave as-is on parse error */
    }
  }

  // Unsaved edits: the in-memory request no longer matches the last-persisted one.
  const dirty = savedSource !== null && JSON.stringify(req) !== savedSource;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  // Live analysis of the request's `${ … }` formulas → the input widgets it actually needs for the
  // current values (Seebo is lazy, so gated inputs are hidden and revealed progressively). The URL is
  // required by the op schema, so skip while it is empty. Stale results are discarded by run id.
  useEffect(() => {
    if (!req.url) {
      setRequirements([]);
      setDiags([]);
      return;
    }
    const run = ++analyzeRun.current;
    const handle = setTimeout(() => {
      void client
        .call('api.analyze', { templateId, request: req, values: compactValues(values) })
        .then((res) => {
          if (run !== analyzeRun.current) return;
          for (const r of res.requirements) if (r.options) optionsCache.current.set(r.id, r.options);
          // Backfill dynamic options for inputs already filled (no longer pending on the engine).
          setRequirements(
            res.requirements.map((r) =>
              r.options ? r : { ...r, options: optionsCache.current.get(r.id) ?? null },
            ),
          );
          setDiags(res.diagnostics);
        })
        .catch(() => {
          if (run === analyzeRun.current) {
            setRequirements([]);
            setDiags([]);
          }
        });
    }, 300);
    return () => clearTimeout(handle);
  }, [client, templateId, req, values]);

  async function save() {
    const source = JSON.stringify(req);
    await client.call('template.updateSource', { id: templateId, source });
    savedSourceRef.current = source;
    setSavedSource(source);
    notifyTreeChanged();
  }
  async function send() {
    setBusy(true);
    setError(null);
    try {
      await save();
      const vals = compactValues(values);
      await client.call('inputState.set', { templateId, values: vals });
      const res = await client.call('http.send', { templateId, request: req, values: vals });
      setResponse(res.response);
      // A "Request render" tab is offered only when formulas were actually rendered.
      setRenderedReq(res.rendered && res.request ? res.request : null);
      setResTab('body');
      setHistory((await client.call('api.history.list', { templateId })).items);
    } catch (e) {
      setResponse(null);
      if (e instanceof ApiError) {
        setError(e.swaft.message);
        // Missing inputs → jump to the Input tab so the user can fill the required widgets.
        if (e.swaft.code === 'INPUT_REQUIRED') setReqTab('input');
      } else {
        setError(String(e));
      }
    } finally {
      setBusy(false);
    }
  }
  async function clearHistory() {
    setHistory((await client.call('api.history.clear', { templateId })).items);
  }
  async function addSecret() {
    if (!secretRef.trim()) return;
    setRefs((await client.call('secret.set', { ref: secretRef.trim(), value: secretValue })).refs);
    setSecretRef('');
    setSecretValue('');
  }

  const auth = req.auth ?? { kind: 'none' as const };

  return (
    <div className="api">
      {/* method + URL */}
      <div className="api__bar">
        <div className="api__method" data-method={req.method}>
          <Select
            aria-label={t('api.method')}
            value={req.method}
            onChange={(v) => patch({ method: v as HttpMethod })}
            options={METHODS.map((m) => ({ value: m, label: m }))}
          />
        </div>
        <div className="api__url">
          <SeeboField
            ariaLabel={t('api.url')}
            placeholder={t('api.urlPlaceholder')}
            value={req.url}
            onChange={setUrl}
          />
        </div>
        <Button onClick={() => void send()} disabled={busy || !req.url}>
          {busy ? t('api.sending') : t('api.send')}
        </Button>
        <IconButton label={t('api.save')} className="api__save" onClick={() => void save()}>
          <SaveIcon />
        </IconButton>
      </div>

      <div className="api__cols" ref={colsRef}>
        {/* Request pane */}
        <section className="api__pane" style={{ width: layout.panelWidth, flex: 'none' }}>
          <Tabs
            tabs={[
              ['params', t('api.query')],
              ['headers', t('api.headers')],
              ['body', t('api.body')],
              ['auth', t('api.auth')],
              ['info', t('api.info')],
              ['input', requirements.length ? `${t('api.input')} (${requirements.length})` : t('api.input')],
            ]}
            active={reqTab}
            onSelect={(k) => setReqTab(k as ReqTab)}
          />
          <div className="api__tabbody">
            {reqTab === 'params' && (
              <KeyValueEditor value={splitUrl(req.url).query} onChange={setParams} />
            )}
            {reqTab === 'headers' && (
              <KeyValueEditor value={req.headers ?? {}} onChange={(headers) => patch({ headers })} />
            )}
            {reqTab === 'body' && (
              <BodyEditor
                type={bodyType}
                body={req.body ?? ''}
                onType={setBodyType}
                onBody={(body) => patch({ body })}
                onFormat={() => void formatBody()}
                onCopy={() => copy(req.body ?? '')}
              />
            )}
            {reqTab === 'info' && (
              <InfoTab value={req.info ?? ''} onChange={(info) => patch({ info })} />
            )}
            {reqTab === 'input' && (
              <div className="col" style={{ gap: 'var(--space-3)' }}>
                {diags.length > 0 && (
                  <div className="auth-error" role="alert">
                    {diags.map((d, i) => (
                      <div key={i}>{d.message}</div>
                    ))}
                  </div>
                )}
                {requirements.length === 0 ? (
                  <span className="muted">{t('api.inputEmpty')}</span>
                ) : (
                  <InputPanel
                    requirements={requirements}
                    values={values}
                    onChange={(id, v) => setValues((s) => ({ ...s, [id]: v }))}
                  />
                )}
              </div>
            )}
            {reqTab === 'auth' && (
              <div className="col" style={{ gap: 'var(--space-3)' }}>
                <Select
                  label={t('api.auth')}
                  value={auth.kind}
                  onChange={(v) =>
                    patch({ auth: { ...auth, kind: v as 'none' | 'bearer' | 'basic' | 'apikey' } })
                  }
                  options={[
                    { value: 'none', label: t('api.authNone') },
                    { value: 'bearer', label: 'Bearer' },
                    { value: 'basic', label: 'Basic' },
                    { value: 'apikey', label: 'API key' },
                  ]}
                />
                {auth.kind !== 'none' && (
                  <Select
                    label={t('api.secretRef')}
                    value={auth.secretRef ?? ''}
                    onChange={(v) => patch({ auth: { ...auth, secretRef: v } })}
                    options={[{ value: '', label: '—' }, ...refs.map((r) => ({ value: r, label: r }))]}
                  />
                )}
                <div className="api__secrets">
                  <span className="ui-field__label">{t('api.secrets')}</span>
                  <div className="row" style={{ alignItems: 'flex-end' }}>
                    <TextField
                      label={t('api.secretRef')}
                      value={secretRef}
                      onChange={(e) => setSecretRef(e.target.value)}
                    />
                    <TextField
                      label={t('api.secretValue')}
                      type="password"
                      value={secretValue}
                      onChange={(e) => setSecretValue(e.target.value)}
                    />
                    <IconButton label={t('api.addSecret')} onClick={() => void addSecret()}>
                      <span aria-hidden="true">+</span>
                    </IconButton>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <div
          className="doc__hsplit"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('doc.resizeH')}
          onPointerDown={layout.onHResize}
        />

        {/* Response pane */}
        <section className="api__pane">
          <div className="api__resp-head">
            <Tabs
              tabs={[
                ...(renderedReq
                  ? ([['render', t('api.requestRender')]] as [string, string][])
                  : []),
                ['body', t('api.body')],
                ['headers', t('api.headers')],
                ['history', t('api.history')],
              ]}
              active={resTab}
              onSelect={(k) => setResTab(k as ResTab)}
            />
            {response && (
              <span className={`api-status api-status--${statusKind(response.status)}`}>
                {response.status} {response.statusText} · {response.durationMs} ms
              </span>
            )}
          </div>
          <div className="api__tabbody">
            {error ? (
              <div className="auth-error" role="alert">
                {error}
              </div>
            ) : resTab === 'render' && renderedReq ? (
              <RequestRender request={renderedReq} />
            ) : resTab === 'history' ? (
              <HistoryView history={history} onOpen={setDetail} onClear={() => void clearHistory()} />
            ) : !response ? (
              <span className="muted">{t('api.noResponse')}</span>
            ) : resTab === 'headers' ? (
              <div className="kv-readonly-wrap">
                <div className="api__editor-tools">
                  <IconButton
                    label={t('doc.copy')}
                    onClick={() =>
                      copy(
                        Object.entries(response.headers)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join('\n'),
                      )
                    }
                  >
                    <CopyIcon />
                  </IconButton>
                </div>
                <ul className="kv-readonly">
                  {Object.entries(response.headers).map(([k, v]) => (
                    <li key={k} className="kv-readonly__row">
                      <span className="kv-readonly__key">{k}</span>
                      <span className="muted">{v}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <ResponseBody response={response} onCopy={copy} />
            )}
          </div>
        </section>
      </div>

      {detail && <HistoryDetail item={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function BodyEditor({
  type,
  body,
  onType,
  onBody,
  onFormat,
  onCopy,
}: {
  type: HttpBodyType;
  body: string;
  onType: (t: HttpBodyType) => void;
  onBody: (body: string) => void;
  onFormat: () => void;
  onCopy: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="api__body">
      <div className="api__body-bar">
        {/* Format (left of the listbox, only for JSON) + the body-type listbox, right-aligned. */}
        {type === 'json' && (
          <IconButton label={t('editor.format')} onClick={onFormat}>
            <FormatIcon />
          </IconButton>
        )}
        <Select
          aria-label={t('api.bodyType')}
          value={type}
          onChange={(v) => onType(v as HttpBodyType)}
          options={[
            { value: 'none', label: t('api.bodyNone') },
            { value: 'json', label: 'JSON' },
            { value: 'form', label: t('api.bodyForm') },
            { value: 'text', label: 'TEXT' },
            { value: 'xml', label: 'XML' },
          ]}
        />
      </div>
      {type !== 'none' && (
        <div className="api__body-editor">
          <div className="api__editor-tools">
            <IconButton label={t('doc.copy')} onClick={onCopy}>
              <CopyIcon />
            </IconButton>
          </div>
          <CodeEditor
            value={body}
            language={bodyLanguage(type)}
            onChange={onBody}
            ariaLabel={t('api.body')}
            completionSource={seeboFormulaCompletionSource}
          />
        </div>
      )}
    </div>
  );
}

function InfoTab({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  return (
    <div className="api__info">
      <div className="api__body-bar">
        <button type="button" className="kv__mode" onClick={() => setEditing((e) => !e)}>
          {editing ? t('api.infoPreview') : t('api.infoEdit')}
        </button>
      </div>
      {editing ? (
        <div className="api__body-editor">
          <CodeEditor value={value} language="markdown" onChange={onChange} ariaLabel={t('api.info')} />
        </div>
      ) : (
        <div
          className="api__info-view"
          title={t('api.infoEditHint')}
          onDoubleClick={() => setEditing(true)}
        >
          {value.trim() ? (
            <RenderPreview subtype="markdown" output={value} />
          ) : (
            <span className="muted">{t('api.infoEmpty')}</span>
          )}
        </div>
      )}
    </div>
  );
}

function ResponseBody({
  response,
  onCopy,
}: {
  response: HttpResponseDto;
  onCopy: (text: string) => void;
}) {
  const { t } = useI18n();
  const { display, lang } = useMemo(() => {
    const ct = (response.headers['content-type'] ?? response.headers['Content-Type'] ?? '').toLowerCase();
    if (ct.includes('json')) {
      try {
        return { display: JSON.stringify(JSON.parse(response.body), null, 2), lang: 'json' as const };
      } catch {
        return { display: response.body, lang: 'json' as const };
      }
    }
    if (ct.includes('html')) return { display: response.body, lang: 'html' as const };
    return { display: response.body, lang: null };
  }, [response]);

  return (
    <div className="api__body-editor">
      <div className="api__editor-tools">
        <span className="tree-badge">{lang ?? 'text'}</span>
        <IconButton label={t('doc.copy')} onClick={() => onCopy(display)}>
          <CopyIcon />
        </IconButton>
      </div>
      {/* Off-screen raw copy so tests can read the body without the code gutter noise. */}
      <pre data-testid="api-response-body" style={{ display: 'none' }}>
        {response.body}
      </pre>
      <CodeEditor value={display} language={lang} onChange={() => {}} readOnly />
    </div>
  );
}

/** Overview of the concrete request actually sent (formulas already rendered). */
function RequestRender({ request }: { request: HttpRequestModel }) {
  const { t } = useI18n();
  const headers = request.headers ?? {};
  return (
    <div className="api-render" data-testid="api-request-render">
      <div className="api-render__line">
        <span className="api-render__method" data-method={request.method}>
          {request.method}
        </span>
        <span className="api-render__url">{request.url}</span>
      </div>
      {Object.keys(headers).length > 0 && (
        <div>
          <span className="ui-field__label">{t('api.headers')}</span>
          <ul className="kv-readonly">
            {Object.entries(headers).map(([k, v]) => (
              <li key={k} className="kv-readonly__row">
                <span className="kv-readonly__key">{k}</span>
                <span className="muted">{v}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {request.body && (
        <div>
          <span className="ui-field__label">{t('api.body')}</span>
          <div className="api__body-editor">
            <CodeEditor
              value={request.body}
              language={request.bodyType === 'json' ? 'json' : null}
              onChange={() => {}}
              readOnly
            />
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryView({
  history,
  onOpen,
  onClear,
}: {
  history: ApiHistoryItem[];
  onOpen: (item: ApiHistoryItem) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  if (history.length === 0) return <span className="muted">{t('wsset.empty')}</span>;
  return (
    <div className="api-hist">
      <ul className="api-hist__list">
        {history.map((h) => (
          <li key={h.id}>
            <button type="button" className="api-hist__row" onClick={() => onOpen(h)}>
              <span className={`api-hist__status api-hist__status--${statusKind(h.status)}`}>
                {h.status ?? '—'}
              </span>
              <span className="api-hist__method">{h.method}</span>
              <span className="api-hist__url">{h.url}</span>
              <span className="api-hist__time muted">{shortTime(h.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="api-hist__foot">
        <Button variant="ghost" onClick={onClear}>
          {t('api.clear')}
        </Button>
      </div>
    </div>
  );
}

function HistoryDetail({ item, onClose }: { item: ApiHistoryItem; onClose: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'request' | 'response'>('request');
  return (
    <div className="editor-overlay" role="dialog" aria-modal="true" aria-label={t('api.history')}>
      <div className="editor-modal api-detail">
        <header className="editor-modal__bar">
          <span className="output-modal__title">{t('api.history')}</span>
          <IconButton label={t('name.cancel')} onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </header>
        <div className="api-detail__tabs">
          <Tabs
            tabs={[
              ['request', t('api.request')],
              ['response', t('api.response')],
            ]}
            active={tab}
            onSelect={(k) => setTab(k as 'request' | 'response')}
          />
        </div>
        <div className="api-detail__body">
          {tab === 'request' ? (
            <ul className="kv-readonly">
              <li className="kv-readonly__row">
                <span className="kv-readonly__key">{t('api.method')}</span>
                <span>{item.method}</span>
              </li>
              <li className="kv-readonly__row">
                <span className="kv-readonly__key">{t('api.url')}</span>
                <span className="muted">{item.url}</span>
              </li>
            </ul>
          ) : (
            <ul className="kv-readonly">
              <li className="kv-readonly__row">
                <span className="kv-readonly__key">{t('api.status')}</span>
                <span className={`api-hist__status api-hist__status--${statusKind(item.status)}`}>
                  {item.status ?? '—'}
                </span>
              </li>
              <li className="kv-readonly__row">
                <span className="kv-readonly__key">{t('api.time')}</span>
                <span className="muted">{shortTime(item.createdAt)}</span>
              </li>
            </ul>
          )}
          <p className="muted api-detail__note">{t('api.historyMetaOnly')}</p>
        </div>
      </div>
    </div>
  );
}

function Tabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: [string, string][];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="api__tabs" role="tablist">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={active === key}
          className={`api__tab${active === key ? ' api__tab--active' : ''}`}
          onClick={() => onSelect(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
