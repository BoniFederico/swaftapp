/**
 * Minimal `.eml` parsing for the Output preview: pull the recipient-facing headers (Subject + From/To/
 * Cc/Bcc) and the displayable HTML body. For `multipart/*` payloads the boundary scaffolding and each
 * part's own MIME headers are stripped, so only the chosen part's content is rendered.
 */
export interface EmlParsed {
  subject: string | null;
  fields: { label: 'From' | 'To' | 'Cc' | 'Bcc'; value: string }[];
  body: string;
}

interface Header {
  key: string;
  value: string;
}

/** Parse `Key: value` header lines (folded continuations are ignored — good enough for a preview). */
function parseHeaders(block: string): Header[] {
  return block
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf(':');
      return i === -1 ? null : { key: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
    })
    .filter((h): h is Header => h !== null && h.key !== '');
}

/**
 * Extract the displayable body of a `multipart/*` payload: split on the boundary (tolerant of a
 * missing `--` prefix), pick the `text/html` part (else `text/plain`, else the first), and drop that
 * part's own MIME headers — so boundary markers and `Content-Type` lines never leak into the render.
 */
function extractMultipartBody(body: string, boundary: string): string {
  const isDelim = (l: string) => l.trim().replace(/^--/, '').replace(/--$/, '') === boundary;
  const segments: string[][] = [];
  let cur: string[] | null = null;
  for (const line of body.split(/\r?\n/)) {
    if (isDelim(line)) {
      if (cur) segments.push(cur);
      cur = [];
      continue;
    }
    if (cur) cur.push(line);
  }
  if (cur && cur.length) segments.push(cur);

  const pick = (mime: RegExp): string[] | undefined =>
    segments.find((seg) => seg.some((l) => /^content-type:/i.test(l) && mime.test(l)));
  const seg = pick(/text\/html/i) ?? pick(/text\/plain/i) ?? segments[0];
  if (!seg) return body;
  // Drop the part's leading MIME headers (and the blank line that ends them, if present).
  let i = 0;
  while (i < seg.length && /^[A-Za-z-]+:/.test(seg[i]!)) i++;
  if (i < seg.length && seg[i]!.trim() === '') i++;
  return seg.slice(i).join('\n').trim();
}

export function parseEml(raw: string): EmlParsed {
  const sep = raw.search(/\r?\n\r?\n/);
  const headers = parseHeaders(sep === -1 ? raw : raw.slice(0, sep));
  let body = sep === -1 ? '' : raw.slice(sep).replace(/^\r?\n\r?\n/, '');

  const get = (key: string) => headers.find((h) => h.key.toLowerCase() === key)?.value;
  const contentType = get('content-type') ?? '';
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (/multipart/i.test(contentType) && boundary) body = extractMultipartBody(body, boundary);

  const fields = (['From', 'To', 'Cc', 'Bcc'] as const).flatMap((label) => {
    const value = get(label.toLowerCase());
    return value ? [{ label, value }] : [];
  });
  return { subject: get('subject') ?? null, fields, body };
}
