#!/usr/bin/env node
// Converts the Jekyll (just-the-docs) site in docs/ into GitHub Wiki pages.
//
// docs/ is the single source of truth; the wiki is a generated mirror (see .github/workflows/wiki.yml).
// The conversion:
//   - names each page after its front-matter title (docs/index.md → Home),
//   - strips front matter, kramdown attribute lists ({: .note }, {:toc}) and the TOC <details> block,
//   - turns just-the-docs callouts into bold-labelled blockquotes,
//   - rewrites links between pages to wiki page names, links to other repo files to GitHub URLs,
//     and images to raw.githubusercontent.com URLs,
//   - generates _Sidebar.md from the nav tree (nav_order / parent) and a _Footer.md.
// Maintainer notes under docs/dev/ are skipped.
//
// Usage: node scripts/docs-to-wiki.mjs <docsDir> <wikiDir>

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_REPO = 'BoniFederico/swaftapp';

const CALLOUTS = { note: 'Note', tip: 'Tip', warning: 'Warning', important: 'Important' };

/** Parse a `---`-delimited front matter block of simple `key: value` lines. */
export function parseFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim().replace(/^["'](.*)["']$/, '$1');
    if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
    else if (value === 'true' || value === 'false') value = value === 'true';
    data[kv[1]] = value;
  }
  return { data, body: text.slice(m[0].length) };
}

/**
 * A wiki page name for a title: GitHub shows hyphens in page file names as spaces. Characters that
 * are awkward in URLs or file names are dropped (`&` becomes "and").
 */
export function wikiName(title) {
  return title
    .trim()
    .replace(/&/g, 'and')
    .replace(/[\\/:*?"<>|#%]/g, '')
    .replace(/\s+/g, '-');
}

/** Turn kramdown/just-the-docs markup into plain GitHub-flavoured Markdown. */
export function convertBody(body) {
  // The table of contents block: <details open markdown="block"> … {:toc} … </details>.
  let text = body.replace(/<details[^>]*markdown="block"[^>]*>[\s\S]*?<\/details>\s*/g, '');
  text = text.replace(/\{%\s*(raw|endraw)\s*%\}/g, '');

  const out = [];
  const lines = text.split(/\r?\n/);
  let inFence = false;
  let callout = null; // label waiting for the next block
  let inCallout = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) {
      out.push(inCallout ? `> ${line}` : line);
      continue;
    }
    const attr = /^\s*\{:\s*\.(\w+)[^}]*\}\s*$/.exec(line);
    if (attr && CALLOUTS[attr[1]]) {
      callout = CALLOUTS[attr[1]];
      continue;
    }
    if (/^\s*\{:[^}]*\}\s*$/.test(line)) continue; // other attribute lists ({: .no_toc }, {:toc}, …)
    let clean = line.replace(/\s*\{:\s*[^}]*\}/g, ''); // inline IALs, e.g. "[Start](x.md){: .btn }"
    if (callout && clean.trim() !== '') {
      out.push(`> **${callout}**`, '>');
      inCallout = true;
      callout = null;
    }
    if (inCallout) {
      if (clean.trim() === '') {
        inCallout = false;
        out.push('');
        continue;
      }
      clean = clean.startsWith('>') ? clean : `> ${clean}`;
    }
    out.push(clean);
  }
  return (
    out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}

/**
 * Rewrite relative Markdown links/images in a page at `fromPath` (posix path relative to docs/).
 * `pageNames` maps docs-relative .md paths to wiki page names.
 */
export function rewriteLinks(
  text,
  fromPath,
  pageNames,
  { repo = DEFAULT_REPO, branch = 'main' } = {},
) {
  const fromDir = posix.dirname(fromPath);
  return text.replace(
    /(!?)\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g,
    (all, bang, label, href, title = '') => {
      if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) return all; // absolute URL, mailto:, in-page anchor
      const [pathPart, anchor = ''] = href.split('#');
      const target = posix.normalize(posix.join(fromDir, pathPart));
      const hash = anchor ? `#${anchor}` : '';
      if (bang) {
        return `![${label}](https://raw.githubusercontent.com/${repo}/${branch}/docs/${target}${title})`;
      }
      const page = pageNames.get(target) ?? pageNames.get(posix.join(target, 'index.md'));
      if (page) return `[${label}](${page}${hash}${title})`;
      // Anything else (source files, root docs like CONTRIBUTING.md) lives in the repository.
      const repoPath = posix.normalize(posix.join('docs', target));
      return `[${label}](https://github.com/${repo}/blob/${branch}/${repoPath}${hash}${title})`;
    },
  );
}

/** Build the sidebar: top-level pages by nav_order, children (by `parent` title) nested below. */
export function buildSidebar(pages) {
  const byOrder = (a, b) =>
    (a.data.nav_order ?? 999) - (b.data.nav_order ?? 999) || a.title.localeCompare(b.title);
  const top = pages.filter((p) => !p.data.parent).sort(byOrder);
  const lines = ['### Swaft', ''];
  const render = (page, depth) => {
    lines.push(`${'  '.repeat(depth)}- [${page.title}](${page.name})`);
    for (const child of pages.filter((p) => p.data.parent === page.title).sort(byOrder)) {
      render(child, depth + 1);
    }
  };
  for (const page of top) render(page, 0);
  return lines.join('\n') + '\n';
}

/**
 * Convert docs files ({ path: posix path relative to docs/, content }) into wiki files
 * ({ name: file name, content }).
 */
export function convertDocs(files, opts = {}) {
  const pages = files
    .filter((f) => f.path.endsWith('.md') && !f.path.startsWith('dev/') && f.path !== 'README.md')
    .map((f) => {
      const { data, body } = parseFrontMatter(f.content);
      const title =
        f.path === 'index.md' ? 'Home' : String(data.title ?? posix.basename(f.path, '.md'));
      return { path: f.path, data, body, title };
    });

  // Unique wiki names; a clash (same title in two sections) is disambiguated by the parent title.
  const used = new Set();
  for (const page of pages) {
    let name = wikiName(page.title);
    if (used.has(name) && page.data.parent) name = wikiName(`${page.data.parent} ${page.title}`);
    let n = 2;
    while (used.has(name)) name = `${wikiName(page.title)}-${n++}`;
    used.add(name);
    page.name = name;
  }
  const pageNames = new Map(pages.map((p) => [p.path, p.name]));

  const sourceUrl = (path) =>
    `https://github.com/${opts.repo ?? DEFAULT_REPO}/blob/${opts.branch ?? 'main'}/docs/${path}`;
  const out = pages.map((page) => ({
    name: `${page.name}.md`,
    content: rewriteLinks(convertBody(page.body), page.path, pageNames, opts),
    source: page.path,
  }));
  out.push({ name: '_Sidebar.md', content: buildSidebar(pages) });
  out.push({
    name: '_Footer.md',
    content:
      `This wiki is generated from [\`docs/\`](https://github.com/${opts.repo ?? DEFAULT_REPO}/tree/${opts.branch ?? 'main'}/docs) ` +
      `— edit the docs there (pull requests welcome), not here. Also published at <https://bonifederico.github.io/swaftapp/>.\n`,
  });
  for (const file of out) {
    if (file.source)
      file.content = `<!-- Generated from ${sourceUrl(file.source)} — do not edit here. -->\n\n${file.content}`;
  }
  return out;
}

function walk(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (
      entry.startsWith('_') ||
      entry.startsWith('.') ||
      entry === 'vendor' ||
      entry === 'node_modules'
    )
      continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full, base));
    else files.push(relative(base, full).split('\\').join('/'));
  }
  return files;
}

function main(argv) {
  const [docsDir, wikiDir] = argv;
  if (!docsDir || !wikiDir) {
    console.error('Usage: node scripts/docs-to-wiki.mjs <docsDir> <wikiDir>');
    process.exit(2);
  }
  const files = walk(resolve(docsDir)).map((path) => ({
    path,
    content: readFileSync(join(docsDir, path), 'utf8'),
  }));
  const pages = convertDocs(files, {
    repo: process.env.GITHUB_REPOSITORY || DEFAULT_REPO,
    branch: process.env.WIKI_SOURCE_BRANCH || 'main',
  });
  mkdirSync(wikiDir, { recursive: true });
  // The wiki is fully generated: drop pages that no longer exist in docs/.
  for (const entry of readdirSync(wikiDir)) {
    if (entry.endsWith('.md')) rmSync(join(wikiDir, entry));
  }
  for (const page of pages) writeFileSync(join(wikiDir, page.name), page.content);
  console.log(`wrote ${pages.length} wiki pages to ${wikiDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
