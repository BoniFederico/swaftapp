import { StreamLanguage } from '@codemirror/language';

/** Diagram/keyword vocabulary highlighted as keywords. */
const KEYWORDS =
  /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4Context|subgraph|end|participant|actor|note|loop|alt|opt|par|and|else|rect|activate|deactivate|class|state|section|title|dateFormat|axisFormat|excludes|direction|click|style|linkStyle|classDef|TB|TD|BT|RL|LR)\b/;

/**
 * A small CodeMirror StreamLanguage giving basic syntax highlighting to Mermaid source: comments,
 * strings, link/arrow operators, diagram keywords, numbers and identifiers. No official grammar
 * exists, so this is intentionally lightweight.
 */
export const mermaidLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/%%.*/)) return 'comment';
    if (stream.match(/"(?:[^"\\]|\\.)*"/)) return 'string';
    if (stream.match(/-{1,3}[->x|o]?|={1,3}>|x--x|o--o|\.\.+>|--|::|:::/)) return 'operator';
    if (stream.match(KEYWORDS)) return 'keyword';
    if (stream.match(/[A-Za-z_]\w*/)) return 'variable';
    if (stream.match(/\d+/)) return 'number';
    stream.next();
    return null;
  },
});
