import { describe, expect, it } from 'vitest';
import { toHar, type HarEntryInput } from './har';

describe('toHar', () => {
  it('builds a HAR 1.2 log with one entry per call', () => {
    const entries: HarEntryInput[] = [
      {
        method: 'GET',
        url: 'https://api/x?a=1&b=2',
        status: 200,
        statusText: 'OK',
        durationMs: 42,
        startedDateTime: '2026-01-02T03:04:05.000Z',
        responseHeaders: { 'Content-Type': 'application/json' },
      },
    ];
    const har = toHar(entries) as {
      log: { version: string; entries: Record<string, unknown>[] };
    };
    expect(har.log.version).toBe('1.2');
    expect(har.log.entries).toHaveLength(1);
    const e = har.log.entries[0] as {
      time: number;
      startedDateTime: string;
      request: { method: string; url: string; queryString: { name: string; value: string }[] };
      response: { status: number; headers: { name: string; value: string }[] };
    };
    expect(e.time).toBe(42);
    expect(e.startedDateTime).toBe('2026-01-02T03:04:05.000Z');
    expect(e.request.method).toBe('GET');
    expect(e.request.queryString).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ]);
    expect(e.response.status).toBe(200);
    expect(e.response.headers).toEqual([{ name: 'Content-Type', value: 'application/json' }]);
  });

  it('defaults timestamps and status for deterministic, partial archives', () => {
    const har = toHar([{ method: 'POST', url: 'https://x' }]) as {
      log: { entries: { startedDateTime: string; response: { status: number } }[] };
    };
    expect(har.log.entries[0].startedDateTime).toBe('1970-01-01T00:00:00.000Z');
    expect(har.log.entries[0].response.status).toBe(0);
  });
});
