import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RENDERABLE_SUBTYPES, type RenderResultDto } from '@swaft/shared';
import { CodeEditor } from '../editor/CodeEditor';
import { useI18n } from '../i18n/I18nProvider';
import {
  BoltIcon,
  Card,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  EmptyState,
  FullscreenIcon,
  IconButton,
  useFocusTrap,
  useToast,
} from '../ui';
import { parseEml } from './eml';
import { RenderOutput } from './RenderOutput';
import { RenderPreview } from './RenderPreview';

/** File extension + MIME type to save a rendered output under, by template subtype. */
const EXT: Record<string, string> = {
  html: 'html',
  markdown: 'md',
  css: 'css',
  javascript: 'js',
  java: 'java',
  json: 'json',
  yaml: 'yaml',
  csv: 'csv',
  eml: 'eml',
  text: 'txt',
  xml: 'xml',
  swagger: 'json',
  mermaid: 'mmd',
  echarts: 'json',
};
function extFor(subtype: string | null): string {
  return (subtype && EXT[subtype]) || 'txt';
}
function mimeFor(subtype: string | null): string {
  if (subtype === 'html' || subtype === 'eml') return 'text/html';
  if (subtype === 'csv') return 'text/csv';
  if (subtype === 'json' || subtype === 'swagger' || subtype === 'echarts') return 'application/json';
  return 'text/plain';
}

/** The output body: rendered preview for renderable subtypes, else highlighted read-only code. */
function OutputBody({ subtype, output }: { subtype: string | null; output: string }) {
  if (subtype === 'eml') return <EmlPreview raw={output} />;
  if (RENDERABLE_SUBTYPES.has(subtype ?? '')) {
    return (
      <div className="output-render">
        <RenderOutput subtype={subtype} output={output} />
      </div>
    );
  }
  return (
    <div className="output-code">
      <CodeEditor value={output} language={subtype} onChange={() => {}} readOnly />
    </div>
  );
}

/** Render an `.eml` output: a focused header block (Subject + From/To/Cc/Bcc) above the rendered body. */
function EmlPreview({ raw }: { raw: string }) {
  const { subject, fields, body } = parseEml(raw);
  return (
    <div className="eml">
      <div className="eml__headers">
        {subject && <div className="eml__subject">{subject}</div>}
        {fields.length > 0 && (
          <dl className="eml__fields">
            {fields.map((f) => (
              <div key={f.label} className="eml__row">
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className="eml__body output-render">
        {/* Emails are authored for a light background — render on white "paper" so dark theme stays readable. */}
        <RenderPreview subtype="html" output={body} paper />
      </div>
    </div>
  );
}

/**
 * The Output container shared by the Document and Batch views: a prominent header with right-aligned
 * actions (a bolt shown only when the render prepared actions, copy, download to a file in the
 * template's format, and a fullscreen modal). Renderable subtypes (html/markdown/eml) show rendered;
 * everything else shows as read-only, highlighted code with line numbers — same style as the editor.
 */
export function OutputView({
  result,
  error,
  busy,
  fileBaseName,
  subtype,
  testId,
  versionControl,
}: {
  result: RenderResultDto | null;
  error: string | null;
  busy: boolean;
  /** Base name (no extension) for the downloaded file. */
  fileBaseName: string;
  subtype: string | null;
  testId?: string;
  /** Optional control (the Document view's version listbox) shown left of the header buttons. */
  versionControl?: ReactNode;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [full, setFull] = useState(false);
  const fullOverlayRef = useRef<HTMLDivElement>(null);
  useFocusTrap(fullOverlayRef, full);

  const output = result?.status === 'completed' ? (result.output ?? '') : '';
  const hasOutput = output !== '';
  const hasActions = (result?.actions.length ?? 0) > 0;

  function download() {
    const blob = new Blob([output], { type: mimeFor(subtype) });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileBaseName || 'output'}.${extFor(subtype)}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(output);
      toast.show(t('doc.copied'), 'success');
    } catch {
      toast.show(t('doc.copyFailed'), 'error');
    }
  }

  const body = error ? (
    <div className="auth-error" role="alert">
      {error}
    </div>
  ) : !result ? (
    <EmptyState title={busy ? t('doc.rendering') : t('doc.notRendered')} />
  ) : result.status === 'failed' || result.diagnostics.length > 0 ? (
    <ul className="diag-list">
      {result.diagnostics.map((d, i) => (
        <li key={i} className="diag">
          <span className="diag__code">{d.code}</span> {d.message}
        </li>
      ))}
    </ul>
  ) : result.status === 'waiting' ? (
    <div className="muted">{t('doc.waiting', { ids: result.pending.map((p) => p.id).join(', ') })}</div>
  ) : (
    <OutputBody subtype={subtype} output={output} />
  );

  return (
    <Card
      title={t('doc.output')}
      actions={
        <div className="ui-card__actions output-actions">
          {versionControl}
          {hasActions && (
            <IconButton label={t('doc.hasActions')} onClick={() => {}}>
              <BoltIcon />
            </IconButton>
          )}
          <IconButton label={t('doc.copy')} disabled={!hasOutput} onClick={() => void copy()}>
            <CopyIcon />
          </IconButton>
          <IconButton label={t('doc.download')} disabled={!hasOutput} onClick={download}>
            <DownloadIcon />
          </IconButton>
          <IconButton label={t('doc.fullscreen')} disabled={!hasOutput} onClick={() => setFull(true)}>
            <FullscreenIcon />
          </IconButton>
        </div>
      }
    >
      <div className="output-body">
        {/* Off-screen copy of the raw output so tests can read it without the code gutter noise. */}
        {testId && hasOutput && (
          <pre data-testid={testId} style={{ display: 'none' }}>
            {output}
          </pre>
        )}
        {body}
      </div>
      {full &&
        createPortal(
          <div
            ref={fullOverlayRef}
            className="editor-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={t('doc.output')}
            tabIndex={-1}
          >
            <div className="editor-modal output-modal">
              <header className="editor-modal__bar">
                <span className="output-modal__title">{t('doc.output')}</span>
                <IconButton label={t('name.cancel')} onClick={() => setFull(false)}>
                  <CloseIcon />
                </IconButton>
              </header>
              <div className="output-modal__body output-body">
                <OutputBody subtype={subtype} output={output} />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </Card>
  );
}
