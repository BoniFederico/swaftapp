import { useI18n } from '../i18n/I18nProvider';
import { useTheme } from '../theme/ThemeProvider';
import { markdownToHtml } from './markdown';

/**
 * Renders a Seebo output as a visual preview inside a sandboxed iframe, themed to match the app
 * (so a dark theme doesn't show a white page). `html`/`markdown` subtypes render as a document; any
 * other subtype is shown as preformatted text. Pass `paper` to always render on a light background
 * regardless of the app theme — emails are authored for a light "paper" and their dark text would be
 * unreadable on a dark surface.
 */
export function RenderPreview({
  subtype,
  output,
  paper = false,
}: {
  subtype: string | null;
  output: string;
  paper?: boolean;
}) {
  const { t } = useI18n();
  const { resolved } = useTheme();
  const dark = !paper && resolved === 'dark';
  const bg = dark ? '#1b1b1f' : '#ffffff';
  const fg = dark ? '#e7e7ea' : '#1a1a1a';

  const body =
    subtype === 'markdown'
      ? markdownToHtml(output)
      : subtype === 'html'
        ? output
        : `<pre style="white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,monospace">${escapeHtml(
            output,
          )}</pre>`;

  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
    html{color-scheme:${dark ? 'dark' : 'light'};scrollbar-color:${
      dark ? '#3a3a40 #1b1b1f' : 'auto'
    }}
    html,body{margin:0}
    body{font-family:system-ui,sans-serif;padding:16px;background:${bg};color:${fg}}
    a{color:${dark ? '#7ab7ff' : '#0a66c2'}}
    code{font-family:ui-monospace,monospace}
  </style></head><body>${body}</body></html>`;

  return <iframe className="render-frame" title={t('editor.preview')} sandbox="" srcDoc={doc} />;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
