import { describe, it, expect } from 'vitest';
import { parseEml } from './eml';

describe('parseEml', () => {
  it('keeps only Subject + From/To/Cc/Bcc and hides the rest', () => {
    const raw = [
      'From: a@x.com',
      'To: b@y.com',
      'Cc: c@z.com',
      'Message-Id: <123@x>',
      'Thread-Topic: hello',
      'Subject: Hello there',
      '',
      '<p>Hi</p>',
    ].join('\n');
    const { subject, fields, body } = parseEml(raw);
    expect(subject).toBe('Hello there');
    expect(fields).toEqual([
      { label: 'From', value: 'a@x.com' },
      { label: 'To', value: 'b@y.com' },
      { label: 'Cc', value: 'c@z.com' },
    ]);
    expect(body).toBe('<p>Hi</p>');
  });

  it('strips multipart boundary + part headers (boundary without the leading --)', () => {
    const raw = [
      'From: a@x.com',
      'Subject: Multi',
      'Content-Type: multipart/alternative; boundary="__boundary__"',
      'MIME-Version: 1.0',
      '',
      '__boundary__',
      'Content-Type: text/html; charset="utf-8"',
      '',
      '<h1>Body</h1>',
      '__boundary__--',
    ].join('\n');
    const { body } = parseEml(raw);
    expect(body).toBe('<h1>Body</h1>');
    expect(body).not.toContain('__boundary__');
    expect(body).not.toContain('Content-Type');
  });

  it('prefers the text/html part over text/plain', () => {
    const raw = [
      'Subject: Both',
      'Content-Type: multipart/alternative; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain',
      '',
      'plain text',
      '--b',
      'Content-Type: text/html',
      '',
      '<b>rich</b>',
      '--b--',
    ].join('\n');
    expect(parseEml(raw).body).toBe('<b>rich</b>');
  });

  it('passes a plain (non-multipart) body through', () => {
    const { body, subject } = parseEml('Subject: S\n\n<p>plain</p>');
    expect(subject).toBe('S');
    expect(body).toBe('<p>plain</p>');
  });
});
