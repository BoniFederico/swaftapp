import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { useTheme } from '../theme/ThemeProvider';
import { seeboHighlight } from './seebo-cm';

/**
 * An input that highlights Seebo `${ … }` formula slots, reusing the editor's {@link seeboHighlight}
 * overlay (and the shared `.cm-sb-*` palette). A drop-in replacement for a plain `<input>`/`<textarea>`
 * that keeps the same look while coloring slots. Single line by default (newlines are swallowed);
 * pass `multiline` for a wrapping, textarea-like box (e.g. the key/value bulk editor).
 */
export function SeeboField({
  value,
  onChange,
  ariaLabel,
  placeholder,
  multiline = false,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const { resolved } = useTheme();
  const dark = resolved === 'dark';

  // Create the editor once; value/theme are synced by the effects below.
  useEffect(() => {
    if (!host.current) return;
    const singleLine: Extension[] = [
      // Reject any change that would introduce a newline, and swallow Enter.
      EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr)),
      keymap.of([{ key: 'Enter', run: () => true }]),
    ];
    const state = EditorState.create({
      doc: value,
      extensions: [
        seeboHighlight,
        ...(multiline ? [EditorView.lineWrapping] : singleLine),
        EditorView.contentAttributes.of(ariaLabel ? { 'aria-label': ariaLabel } : {}),
        ...(placeholder ? [cmPlaceholder(placeholder)] : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // Init once; value is synced by the effect below (mirrors CodeEditor).
  }, []);

  // Sync external value changes into the doc, avoiding the onChange echo.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (value !== current) {
      v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return (
    <div
      ref={host}
      className={`seebo-field${multiline ? ' seebo-field--multi' : ''}${dark ? ' cm-host--dark' : ''}`}
    />
  );
}
