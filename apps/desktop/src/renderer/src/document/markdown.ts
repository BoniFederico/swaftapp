/**
 * Minimal, dependency-free Markdown → HTML for the editor preview (headings, bold/italic, inline
 * code, links, unordered lists, paragraphs). The output is shown inside a sandboxed iframe, so this
 * is a convenience renderer, not a full CommonMark implementation.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Allow only harmless link targets; `javascript:`/`data:` and friends render as plain text. */
function safeHref(href: string): string | null {
  return /^(https?:|mailto:|#|\/)/i.test(href.trim()) ? href : null;
}

function emphasis(s: string): string {
  return (
    s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      // Underscore forms only at word boundaries, so snake_case identifiers are left alone.
      .replace(/(^|[^\w])__([^_]+)__(?!\w)/g, '$1<strong>$2</strong>')
      .replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1<em>$2</em>')
  );
}

const MARK = '';
const TOKEN = /(\d+)/g;

function inline(s: string): string {
  // Code spans and link targets are set aside as placeholder tokens first, so emphasis never
  // reaches inside them (`__init__`, `https://x/_private_/`), then restored at the end.
  // The sentinel is a Unicode private-use character, stripped from the input so it can't collide.
  const tokens: string[] = [];
  const hold = (html: string) => `${MARK}${tokens.push(html) - 1}${MARK}`;
  const text = escapeHtml(s.split(MARK).join(''))
    .replace(/`([^`]+)`/g, (_m, code: string) => hold(`<code>${code}</code>`))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label: string, href: string) =>
      // The preview iframe is sandboxed, so this is defense in depth, not the only barrier.
      safeHref(href) ? hold(`<a href="${href}">${emphasis(label)}</a>`) : match,
    );
  return emphasis(text).replace(TOKEN, (_m, i: string) => tokens[Number(i)] ?? '');
}

export function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
    } else if (item) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(item[1]!)}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}
