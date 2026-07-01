import { useEffect, useRef } from 'react';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  type LanguageSupport,
} from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import type { CompletionSource } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { useTheme } from '../theme/ThemeProvider';
import { seeboCompletionSource, seeboHighlight } from './seebo-cm';

/** Atom One Light / Dark syntax themes — a familiar, polished look in both modes. */
const HIGHLIGHT_LIGHT = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#a0a1a7', fontStyle: 'italic' },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: '#a626a4' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#50a14f' },
  { tag: [t.number, t.bool, t.atom, t.null], color: '#986801' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#4078f2' },
  { tag: [t.propertyName], color: '#e45649' },
  { tag: [t.attributeName], color: '#986801' },
  { tag: [t.typeName, t.className, t.namespace], color: '#c18401' },
  { tag: [t.tagName], color: '#e45649' },
  { tag: [t.operator, t.operatorKeyword], color: '#0184bc' },
  { tag: [t.heading], fontWeight: 'bold', color: '#4078f2' },
  { tag: [t.link, t.url], color: '#0184bc', textDecoration: 'underline' },
]);
const HIGHLIGHT_DARK = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#7f848e', fontStyle: 'italic' },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: '#c678dd' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#98c379' },
  { tag: [t.number, t.bool, t.atom, t.null], color: '#d19a66' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#61afef' },
  { tag: [t.propertyName], color: '#e06c75' },
  { tag: [t.attributeName], color: '#d19a66' },
  { tag: [t.typeName, t.className, t.namespace], color: '#e5c07b' },
  { tag: [t.tagName], color: '#e06c75' },
  { tag: [t.operator, t.operatorKeyword], color: '#56b6c2' },
  { tag: [t.heading], fontWeight: 'bold', color: '#61afef' },
  { tag: [t.link, t.url], color: '#56b6c2', textDecoration: 'underline' },
]);
const highlightFor = (dark: boolean) =>
  syntaxHighlighting(dark ? HIGHLIGHT_DARK : HIGHLIGHT_LIGHT);

/** Lazy-load the language support for a subtype (keeps each grammar out of the main chunk). */
async function loadLanguage(subtype: string | null): Promise<Extension> {
  switch (subtype) {
    case 'html':
      return (await import('@codemirror/lang-html')).html() as LanguageSupport;
    case 'css':
      return (await import('@codemirror/lang-css')).css() as LanguageSupport;
    case 'javascript':
      return (await import('@codemirror/lang-javascript')).javascript() as LanguageSupport;
    case 'json':
    case 'swagger':
    case 'echarts':
      return (await import('@codemirror/lang-json')).json() as LanguageSupport;
    case 'markdown':
      return (await import('@codemirror/lang-markdown')).markdown() as LanguageSupport;
    case 'yaml':
      return (await import('@codemirror/lang-yaml')).yaml() as LanguageSupport;
    case 'java':
      return (await import('@codemirror/lang-java')).java() as LanguageSupport;
    case 'mermaid':
      return (await import('./mermaid-lang')).mermaidLanguage;
    default:
      return [];
  }
}

/**
 * A reusable CodeMirror 6 editor: line numbers, history, bracket matching, syntax highlight for the
 * given subtype (lazy-loaded grammar) plus Seebo formula highlighting and autocompletion. Themed to
 * inherit the app surface (transparent background) and the monospace font token.
 */
export function CodeEditor({
  value,
  language,
  onChange,
  ariaLabel,
  readOnly = false,
  completionSource = seeboCompletionSource,
}: {
  value: string;
  language: string | null;
  onChange: (value: string) => void;
  ariaLabel?: string;
  /** Read-only mode (e.g. showing rendered output as highlighted code, not editing). */
  readOnly?: boolean;
  /** Seebo completions offered inside slots; defaults to the full set (widgets + `action` + types). */
  completionSource?: CompletionSource;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const { resolved } = useTheme();
  const dark = resolved === 'dark';

  // Create the editor once.
  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        indentOnInput(),
        // Find/replace panel (Ctrl/Cmd+F), VS Code-style — works read-only too (replace only when editable).
        search({ top: true }),
        highlightSelectionMatches(),
        keymap.of([
          ...searchKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        themeCompartment.current.of(highlightFor(dark)),
        langCompartment.current.of([]),
        seeboHighlight,
        ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
        autocompletion({ override: [completionSource] }),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of(ariaLabel ? { 'aria-label': ariaLabel } : {}),
        EditorView.theme({
          '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--text)' },
          '.cm-content': { caretColor: 'var(--text)' },
          '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: '1.6' },
          '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)' },
          '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--text) 5%, transparent)' },
          '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
          // Find/replace panel (Ctrl/Cmd+F) — themed via app tokens so it matches the app in dark/light.
          // Styled here (not in styles.css) so it out-prioritizes CodeMirror's runtime base theme.
          '.cm-panels': {
            backgroundColor: 'var(--surface)',
            color: 'var(--text)',
            fontFamily: 'var(--font-sans, system-ui, sans-serif)',
          },
          '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
          '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
          '.cm-search': {
            position: 'relative',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '6px',
            padding: '10px 36px 10px 12px',
            fontSize: '12px',
          },
          '.cm-search br': { flexBasis: '100%', height: 0, margin: 0, border: 'none' },
          '.cm-search .cm-textfield': {
            backgroundColor: 'var(--bg)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '5px 9px',
            fontSize: '12px',
            minWidth: '210px',
          },
          '.cm-search .cm-textfield:focus': { outline: 'none', borderColor: 'var(--primary)' },
          '.cm-search .cm-button': {
            backgroundColor: 'transparent',
            backgroundImage: 'none',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '5px 10px',
            fontSize: '12px',
            cursor: 'pointer',
            textTransform: 'none',
          },
          '.cm-search .cm-button:hover': { borderColor: 'var(--primary)', color: 'var(--primary)' },
          '.cm-search label': {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            color: 'var(--text-muted)',
            fontSize: '12px',
          },
          '.cm-search label input': { margin: 0 },
          '.cm-search [name="close"]': {
            position: 'absolute',
            top: '6px',
            right: '8px',
            width: '22px',
            height: '22px',
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: 'var(--text-muted)',
            fontSize: '18px',
            lineHeight: '20px',
            cursor: 'pointer',
          },
          '.cm-search [name="close"]:hover': { color: 'var(--text)' },
        }),
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
    // Init once; value/language are synced by the effects below.
  }, []);

  // Sync external value changes (e.g. switching release) into the doc, avoiding the onChange echo.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (value !== current) {
      v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  // Swap the syntax theme when light/dark changes.
  useEffect(() => {
    view.current?.dispatch({
      effects: themeCompartment.current.reconfigure(highlightFor(dark)),
    });
  }, [dark]);

  // Swap the language grammar when the subtype changes.
  useEffect(() => {
    let cancelled = false;
    void loadLanguage(language).then((ext) => {
      if (!cancelled && view.current) {
        view.current.dispatch({ effects: langCompartment.current.reconfigure(ext) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return <div ref={host} className={`cm-host${resolved === 'dark' ? ' cm-host--dark' : ''}`} />;
}
