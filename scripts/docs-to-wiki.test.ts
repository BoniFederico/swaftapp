import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script without type declarations
import {
  convertBody,
  convertDocs,
  parseFrontMatter,
  rewriteLinks,
  wikiName,
} from './docs-to-wiki.mjs';

describe('docs-to-wiki', () => {
  it('parses simple front matter', () => {
    const { data, body } = parseFrontMatter(
      '---\ntitle: User guide\nnav_order: 5\nhas_children: true\n---\n# Hi\n',
    );
    expect(data).toEqual({ title: 'User guide', nav_order: 5, has_children: true });
    expect(body).toBe('# Hi\n');
  });

  it('names pages after their titles', () => {
    expect(wikiName('API requests')).toBe('API-requests');
    expect(wikiName('Security & settings')).toBe('Security-and-settings');
  });

  it('strips the TOC block and attribute lists, and converts callouts', () => {
    const body = [
      '# Getting started',
      '{: .no_toc }',
      '',
      'Intro text.',
      '{: .fs-6 .fw-300 }',
      '',
      '<details open markdown="block">',
      '  <summary>Table of contents</summary>',
      '  {: .text-delta }',
      '1. TOC',
      '{:toc}',
      '</details>',
      '',
      '{: .note }',
      '> There is **no account**.',
      '> Second line.',
      '',
      '{: .warning }',
      'Plain paragraph callout.',
      '',
      '[Start](getting-started.md){: .btn .btn-primary }',
      '',
      '```js',
      '{: .not-an-ial-in-code }',
      '```',
    ].join('\n');
    expect(convertBody(body)).toBe(
      [
        '# Getting started',
        '',
        'Intro text.',
        '',
        '> **Note**',
        '>',
        '> There is **no account**.',
        '> Second line.',
        '',
        '> **Warning**',
        '>',
        '> Plain paragraph callout.',
        '',
        '[Start](getting-started.md)',
        '',
        '```js',
        '{: .not-an-ial-in-code }',
        '```',
        '',
      ].join('\n'),
    );
  });

  it('rewrites page links, repo links and images', () => {
    const names = new Map([
      ['index.md', 'Home'],
      ['guide/scenarios.md', 'Scenarios'],
      ['guide/index.md', 'User-guide'],
    ]);
    const text = [
      '[s](scenarios.md#breakpoints)',
      '[home](../index.md)',
      '[guide](./)',
      '[ext](https://example.com/x.md)',
      '[anchor](#top)',
      '[src](../../apps/desktop/src/main/index.ts)',
      '![shot](../assets/screenshots/scenario-canvas.png)',
    ].join('\n');
    expect(
      rewriteLinks(text, 'guide/api-requests.md', names, { repo: 'o/r', branch: 'main' }),
    ).toBe(
      [
        '[s](Scenarios#breakpoints)',
        '[home](Home)',
        '[guide](User-guide)',
        '[ext](https://example.com/x.md)',
        '[anchor](#top)',
        '[src](https://github.com/o/r/blob/main/apps/desktop/src/main/index.ts)',
        '![shot](https://raw.githubusercontent.com/o/r/main/docs/assets/screenshots/scenario-canvas.png)',
      ].join('\n'),
    );
  });

  it('converts a docs tree into pages plus a nested sidebar, skipping maintainer notes', () => {
    const files = [
      {
        path: 'index.md',
        content: '---\ntitle: Home\nnav_order: 1\n---\nSee [guide](guide/index.md).\n',
      },
      {
        path: 'guide/index.md',
        content: '---\ntitle: User guide\nnav_order: 5\nhas_children: true\n---\nGuide\n',
      },
      {
        path: 'guide/b.md',
        content: '---\ntitle: Beta\nparent: User guide\nnav_order: 2\n---\nB\n',
      },
      {
        path: 'guide/a.md',
        content: '---\ntitle: Alpha\nparent: User guide\nnav_order: 1\n---\nA\n',
      },
      { path: 'installation.md', content: '---\ntitle: Installation\nnav_order: 2\n---\nI\n' },
      { path: 'dev/releasing.md', content: '---\ntitle: Releasing\n---\nR\n' },
      { path: 'assets/x.png', content: '' },
    ];
    const out = convertDocs(files, { repo: 'o/r' });
    const names = out.map((f: { name: string }) => f.name).sort();
    expect(names).toEqual([
      'Alpha.md',
      'Beta.md',
      'Home.md',
      'Installation.md',
      'User-guide.md',
      '_Footer.md',
      '_Sidebar.md',
    ]);
    const home = out.find((f: { name: string }) => f.name === 'Home.md');
    expect(home.content).toContain('See [guide](User-guide).');
    expect(home.content).toContain(
      '<!-- Generated from https://github.com/o/r/blob/main/docs/index.md',
    );
    const sidebar = out.find((f: { name: string }) => f.name === '_Sidebar.md').content;
    expect(sidebar).toBe(
      '### Swaft\n\n- [Home](Home)\n- [Installation](Installation)\n- [User guide](User-guide)\n  - [Alpha](Alpha)\n  - [Beta](Beta)\n',
    );
  });
});

describe('docs-to-wiki callouts in lists', () => {
  it('keeps a callout nested under a list item inside that item', () => {
    const body = ['1. Step one', '', '   {: .warning }', '   > Careful here.', '', '2. Step two'].join('\n');
    expect(convertBody(body)).toBe(
      ['1. Step one', '', '   > **Warning**', '   >', '   > Careful here.', '', '2. Step two', ''].join('\n'),
    );
  });
});
