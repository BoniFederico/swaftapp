import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { Prec, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/**
 * CodeMirror integration for Seebo template formulas. Two concerns, decoupled and reusable:
 *  - {@link seeboHighlight}: a decoration overlay that **semantically** highlights the content of
 *    every `${…}` / `@{…}` slot (delimiters, function names, strings, numbers, property keys,
 *    keywords) on top of the base-language highlight, which still colors everything outside slots.
 *  - {@link seeboCompletionSource}: completions (widgets, types, effects) offered only inside a slot.
 */
const mark = (cls: string) => Decoration.mark({ class: cls });
const DELIM = mark('cm-sb-delim');
const FN = mark('cm-sb-fn');
const STR = mark('cm-sb-str');
const NUM = mark('cm-sb-num');
const PROP = mark('cm-sb-prop');
const KW = mark('cm-sb-kw');
const PUNC = mark('cm-sb-punc');
/** A whole-slot bare identifier (`${ name }`) — the env-fallback sugar reads it as an env var. */
const ENVREF = mark('cm-sb-envref');

const KEYWORDS = new Set(['true', 'false', 'null']);
/** Matches a slot whose entire content is one bare identifier (captures its offsets via index). */
const BARE_INNER = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*$/;
const TOKEN = /('(?:[^'\\]|\\.)*')|(\d+(?:\.\d+)?)|([A-Za-z_$][\w$]*)|([{}()[\],:.])/g;

type Item = { from: number; to: number; deco: Decoration };

/** Tokenize a slot's inner content into semantic ranges (absolute positions via `base`). */
function tokenize(inner: string, base: number, out: Item[]): void {
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(inner)) !== null) {
    const from = base + m.index;
    const to = from + m[0].length;
    if (m[1]) out.push({ from, to, deco: STR });
    else if (m[2]) out.push({ from, to, deco: NUM });
    else if (m[3]) {
      const after = inner.slice(m.index + m[0].length).match(/^\s*(.)/)?.[1] ?? '';
      if (after === '(') out.push({ from, to, deco: FN });
      else if (after === ':') out.push({ from, to, deco: PROP });
      else if (KEYWORDS.has(m[3])) out.push({ from, to, deco: KW });
    } else if (m[4]) out.push({ from, to, deco: PUNC });
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const items: Item[] = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if ((ch === '$' || ch === '@') && text[i + 1] === '{') {
        const slotStart = from + i;
        items.push({ from: slotStart, to: slotStart + 2, deco: DELIM });
        i += 2;
        const innerStart = i;
        let depth = 1;
        while (i < text.length && depth > 0) {
          const c = text[i];
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) break;
          }
          i++;
        }
        const inner = text.slice(innerStart, i);
        // A whole-slot bare identifier is the env-var sugar (`${ pesca }` ≈ `${ env('pesca') }`):
        // give it its own color so the special meaning reads at a glance.
        const bare = BARE_INNER.exec(inner);
        if (bare && !KEYWORDS.has(bare[2]!)) {
          const start = from + innerStart + bare[1]!.length;
          items.push({ from: start, to: start + bare[2]!.length, deco: ENVREF });
        } else {
          tokenize(inner, from + innerStart, items);
        }
        if (text[i] === '}') {
          items.push({ from: from + i, to: from + i + 1, deco: DELIM });
          i++;
        }
      } else {
        i++;
      }
    }
  }
  items.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const it of items) builder.add(it.from, it.to, it.deco);
  return builder.finish();
}

const seeboHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
/**
 * Wrapped at `Prec.highest` so its marks nest *innermost* against the base language's syntax-highlight
 * spans (CodeMirror nests overlapping mark decorations by extension precedence — the highest-precedence
 * source wraps closest to the text). Without this, the base highlight's span ends up innermost and its
 * color always wins over ours for its own text, however the CSS specificity of `.cm-sb-*` is tuned.
 */
export const seeboHighlight = Prec.highest(seeboHighlightPlugin);

const widget = (name: string, detail: string, body: string): Completion =>
  snippetCompletion(`${name}({ ${body} })`, { label: name, type: 'function', detail });

const WIDGET_COMPLETIONS: Completion[] = [
  widget('textbox', 'text input', "id: '${id}', label: '${Label}', type: string()"),
  widget('textarea', 'multi-line text', "id: '${id}', label: '${Label}', type: string()"),
  widget('number', 'numeric input', "id: '${id}', label: '${Label}', type: int()"),
  widget('boolean', 'toggle', "id: '${id}', label: '${Label}', type: bool()"),
  widget('listbox', 'single choice', "id: '${id}', label: '${Label}', type: string(), options: ['${A}', '${B}']"),
  widget('multiOption', 'multiple choice', "id: '${id}', label: '${Label}', type: string(), options: ['${A}', '${B}']"),
  widget('jsonInput', 'JSON input', "id: '${id}', label: '${Label}', type: object()"),
  widget('datetimebox', 'date & time', "id: '${id}', label: '${Label}', type: datetime()"),
  widget('durationbox', 'duration', "id: '${id}', label: '${Label}', type: duration()"),
  widget('need', 'required input', "id: '${id}', type: string(), capability: 'input'"),
];
/** Data capabilities: auto-resolved during render (no user input). Usable in documents and fields. */
const DATA_COMPLETIONS: Completion[] = [
  widget('env', 'active environment variable', "id: '${KEY}', type: string()"),
];
const TYPE_COMPLETIONS: Completion[] = ['string()', 'int()', 'float()', 'bool()', 'datetime()', 'duration()', 'object()'].map(
  (label): Completion => ({ label, type: 'type' }),
);
const ACTION_COMPLETION = snippetCompletion(
  "action({ id: '${id}', type: '${type}', input: { ${field}: ${value} }, confirm: true, environment: 'test' })",
  { label: 'action', type: 'function', detail: 'external effect' },
);
/** Full set (documents/templates): widgets, data capabilities, the `action` effect, and types. */
const SEEBO_COMPLETIONS: Completion[] = [
  ...WIDGET_COMPLETIONS,
  ...DATA_COMPLETIONS,
  ACTION_COMPLETION,
  ...TYPE_COMPLETIONS,
];
/** Pure subset for fields where effects are forbidden (API request fields): no `action`. */
const SEEBO_FORMULA_COMPLETIONS: Completion[] = [
  ...WIDGET_COMPLETIONS,
  ...DATA_COMPLETIONS,
  ...TYPE_COMPLETIONS,
];

/** True when the cursor sits inside an unclosed `${` / `@{` slot. */
function insideSeeboSlot(context: CompletionContext): boolean {
  const before = context.state.doc.sliceString(0, context.pos);
  const open = Math.max(before.lastIndexOf('${'), before.lastIndexOf('@{'));
  return open !== -1 && before.indexOf('}', open) === -1;
}

/** Build a slot-scoped completion source over a fixed option list. */
function completionSourceFor(options: Completion[]) {
  return (context: CompletionContext): CompletionResult | null => {
    if (!insideSeeboSlot(context)) return null;
    const word = context.matchBefore(/[A-Za-z()]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    return { from: word.from, options, validFor: /^[A-Za-z()]*$/ };
  };
}

/** Default completion source (widgets + `action` + types). */
export const seeboCompletionSource = completionSourceFor(SEEBO_COMPLETIONS);
/** Effect-free completion source (no `action`) for pure-render fields like API request fields. */
export const seeboFormulaCompletionSource = completionSourceFor(SEEBO_FORMULA_COMPLETIONS);
