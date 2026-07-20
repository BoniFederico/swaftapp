import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, hoverTooltip, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { useTheme } from '../theme/ThemeProvider';
import { seeboHighlight } from './seebo-cm';

/** Locate the `${…}`/`#{…}`/`@{…}` slot containing `pos` (balanced braces), or null. */
function slotAt(doc: string, pos: number): { from: number; to: number } | null {
  for (let i = 0; i < doc.length - 1; i++) {
    if ((doc[i] === '$' || doc[i] === '#' || doc[i] === '@') && doc[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < doc.length && depth > 0) {
        if (doc[j] === '{') depth++;
        else if (doc[j] === '}') depth--;
        j++;
      }
      if (pos >= i && pos < j) return { from: i, to: j };
      i = j - 1;
    }
  }
  return null;
}

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
  preview,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  multiline?: boolean;
  /**
   * Hover preview: given the hovered `${ … }` slot source, resolve its rendered value (null = no
   * tooltip, e.g. the formula still needs user input). Debounced by CodeMirror's hover delay; the
   * caller is expected to cache.
   */
  preview?: (slot: string) => Promise<string | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Latest preview callback, readable from the once-created extension.
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const hasPreview = preview != null;
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
    // Renders the hovered formula's value in a tooltip when it can resolve without pending inputs.
    const previewExtension = hoverTooltip(
      async (v, pos) => {
        const fn = previewRef.current;
        if (!fn) return null;
        const doc = v.state.doc.toString();
        const slot = slotAt(doc, pos);
        if (!slot) return null;
        const text = await fn(doc.slice(slot.from, slot.to));
        if (text == null) return null;
        return {
          pos: slot.from,
          end: slot.to,
          above: true,
          create: () => {
            const dom = document.createElement('div');
            dom.className = 'sb-preview';
            dom.textContent = text;
            return { dom };
          },
        };
      },
      { hoverTime: 350 },
    );
    const state = EditorState.create({
      doc: value,
      extensions: [
        seeboHighlight,
        ...(hasPreview ? [previewExtension] : []),
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
