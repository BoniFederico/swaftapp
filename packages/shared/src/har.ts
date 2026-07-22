/**
 * Export HTTP call history as a **HAR 1.2** log ("HTTP Archive") — open-standards plan §6.1. HAR is a
 * JSON format for captured request/response traffic, widely importable (browsers, Postman, etc.).
 *
 * Swaft's history is metadata-only (method/url/status/timing, never bodies), so the emitted HAR carries
 * those with empty request/response bodies — a valid, if partial, archive. Pure and deterministic:
 * timestamps are supplied by the caller (defaulting to the epoch) so the output is stable in tests.
 */

export interface HarEntryInput {
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  durationMs?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  /** ISO-8601 start time; defaults to the epoch when absent (keeps exports deterministic). */
  startedDateTime?: string;
}

interface HarNameValue {
  name: string;
  value: string;
}

function headerList(headers: Record<string, string> | undefined): HarNameValue[] {
  return Object.entries(headers ?? {}).map(([name, value]) => ({ name, value }));
}

function queryList(url: string): HarNameValue[] {
  const q = url.indexOf('?');
  if (q === -1) return [];
  return url
    .slice(q + 1)
    .split('&')
    .filter((p) => p !== '')
    .map((pair) => {
      const eq = pair.indexOf('=');
      return eq >= 0
        ? { name: pair.slice(0, eq), value: pair.slice(eq + 1) }
        : { name: pair, value: '' };
    });
}

function entry(e: HarEntryInput): Record<string, unknown> {
  const time = e.durationMs ?? 0;
  return {
    startedDateTime: e.startedDateTime ?? '1970-01-01T00:00:00.000Z',
    time,
    request: {
      method: e.method,
      url: e.url,
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: headerList(e.requestHeaders),
      queryString: queryList(e.url),
      headersSize: -1,
      bodySize: -1,
    },
    response: {
      status: e.status ?? 0,
      statusText: e.statusText ?? '',
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: headerList(e.responseHeaders),
      content: { size: 0, mimeType: '', text: '' },
      redirectURL: '',
      headersSize: -1,
      bodySize: -1,
    },
    cache: {},
    timings: { send: -1, wait: time, receive: -1 },
  };
}

/** Build a HAR 1.2 log object from history entries. */
export function toHar(entries: HarEntryInput[]): Record<string, unknown> {
  return {
    log: {
      version: '1.2',
      creator: { name: 'Swaft', version: '0.0.0' },
      entries: entries.map(entry),
    },
  };
}
