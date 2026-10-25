import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './markdown';

describe('markdownToHtml', () => {
  it('renders headings, emphasis, code and lists', () => {
    expect(markdownToHtml('# Title\n\n**bold** and *it*\n\n- a\n- `b`')).toBe(
      '<h1>Title</h1>\n<p><strong>bold</strong> and <em>it</em></p>\n<ul>\n<li>a</li>\n<li><code>b</code></li>\n</ul>',
    );
  });

  it('supports underscore emphasis at word boundaries only', () => {
    expect(markdownToHtml('_Generated in 2026._')).toBe('<p><em>Generated in 2026.</em></p>');
    expect(markdownToHtml('__strong__ text')).toBe('<p><strong>strong</strong> text</p>');
    expect(markdownToHtml('call my_var_name now')).toBe('<p>call my_var_name now</p>');
  });

  it('neutralizes unsafe links and escapes HTML', () => {
    expect(markdownToHtml('[x](javascript:alert(1)) <b>')).toBe(
      '<p>[x](javascript:alert(1)) &lt;b&gt;</p>',
    );
  });
});
