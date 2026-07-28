import { describe, expect, it } from 'vitest';
import { parseFrontMatter, toFrontMatter, type DocumentMeta } from './front-matter';

const meta: DocumentMeta = {
  swaftId: '7f3a',
  name: 'Release notes',
  type: 'document',
  subtype: 'markdown',
  tags: ['ops', 'template'],
};

describe('toFrontMatter / parseFrontMatter', () => {
  it('round-trips typical metadata + body', () => {
    const doc = toFrontMatter(meta, '# Hello ${ name }\n');
    expect(doc).toBe(
      ['---', 'swaftId: 7f3a', 'name: Release notes', 'type: document', 'subtype: markdown', 'tags: [ops, template]', '---', '# Hello ${ name }', ''].join('\n'),
    );
    const parsed = parseFrontMatter(doc);
    expect(parsed.meta).toEqual(meta);
    expect(parsed.body).toBe('# Hello ${ name }\n');
  });

  it('omits absent keys and returns body only for empty meta', () => {
    expect(toFrontMatter({}, 'just a body')).toBe('just a body');
    expect(toFrontMatter({ name: 'x' }, 'b')).toBe('---\nname: x\n---\nb');
  });

  it('quotes scalars that need it', () => {
    const doc = toFrontMatter({ name: 'A: tricky, name' }, 'b');
    expect(doc).toContain('name: "A: tricky, name"');
    expect(parseFrontMatter(doc).meta.name).toBe('A: tricky, name');
  });

  it('preserves Seebo formulas in the body verbatim', () => {
    const body = 'Total: ${ qty * price } for ${ env(\'CUSTOMER\') }';
    const parsed = parseFrontMatter(toFrontMatter({ subtype: 'markdown' }, body));
    expect(parsed.body).toBe(body);
  });

  it('parses a block-style tags list', () => {
    const parsed = parseFrontMatter('---\nname: x\ntags:\n  - a\n  - b\n---\nbody');
    expect(parsed.meta.tags).toEqual(['a', 'b']);
    expect(parsed.body).toBe('body');
  });

  it('treats a leading --- thematic break as body, not front matter', () => {
    const md = '---\nThis is a horizontal rule paragraph, not key: value pairs everywhere\nmore text';
    // the first non-empty block line is not `key: value` in a valid way → whole thing is body
    const parsed = parseFrontMatter('---\njust prose with no colon\n---\nx');
    expect(parsed.meta).toEqual({});
    expect(parsed.body).toBe('---\njust prose with no colon\n---\nx');
    expect(parseFrontMatter(md).meta).toEqual({});
  });

  it('returns body unchanged when there is no front matter', () => {
    expect(parseFrontMatter('# plain\nbody')).toEqual({ meta: {}, body: '# plain\nbody' });
  });

  it('normalizes CRLF', () => {
    expect(parseFrontMatter('---\r\nname: x\r\n---\r\nbody').meta.name).toBe('x');
  });
});
