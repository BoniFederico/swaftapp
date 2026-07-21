import { useEffect, useRef, useState } from 'react';
import { MergeView } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { highlightFor, loadLanguage } from '../editor/CodeEditor';
import { useTheme } from '../theme/ThemeProvider';

/** App-token theme shared by both diff panes (transparent surface, monospace, muted gutters). */
const PANE_THEME = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)' },
});

/**
 * A native CodeMirror side-by-side diff (@codemirror/merge `MergeView`): the committed version on
 * the left, the working-tree version on the right, with changed lines/characters highlighted and
 * full syntax highlighting (reusing the Template Editor's language + theme). Both sides are
 * read-only. Recreated when its inputs change (the dialog opens with fixed content).
 */
export function GitDiffView({
  oldText,
  newText,
  language,
}: {
  oldText: string;
  newText: string;
  language: string | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();
  const dark = resolved === 'dark';
  const [lang, setLang] = useState<Extension>([]);

  useEffect(() => {
    let cancelled = false;
    void loadLanguage(language).then((ext) => !cancelled && setLang(ext));
    return () => {
      cancelled = true;
    };
  }, [language]);

  useEffect(() => {
    if (!host.current) return;
    const shared: Extension = [
      lineNumbers(),
      highlightFor(dark),
      lang,
      EditorView.lineWrapping,
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      PANE_THEME,
    ];
    const view = new MergeView({
      a: { doc: oldText, extensions: shared },
      b: { doc: newText, extensions: shared },
      parent: host.current,
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 4 },
    });
    return () => view.destroy();
  }, [oldText, newText, dark, lang]);

  return <div ref={host} className="git-mergeview" />;
}
