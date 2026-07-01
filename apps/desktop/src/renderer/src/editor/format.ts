import type { Options } from 'prettier';

/**
 * Format the editor content for a formattable subtype via Prettier. Prettier and its language
 * plugins are **lazy-loaded** on demand (kept out of the main chunk). Throws when the content cannot
 * be parsed (e.g. it contains Seebo formulas that break the target grammar) — the caller surfaces
 * that as a toast.
 */
export async function formatSource(subtype: string, source: string): Promise<string> {
  const { format } = await import('prettier/standalone');
  return format(source, await prettierOptions(subtype));
}

async function prettierOptions(subtype: string): Promise<Options> {
  switch (subtype) {
    case 'html':
      return { parser: 'html', plugins: [await import('prettier/plugins/html')] };
    case 'css':
      return { parser: 'css', plugins: [await import('prettier/plugins/postcss')] };
    case 'javascript':
      return {
        parser: 'babel',
        plugins: [await import('prettier/plugins/babel'), await import('prettier/plugins/estree')],
      };
    case 'json':
    case 'swagger':
      return {
        parser: 'json',
        plugins: [await import('prettier/plugins/babel'), await import('prettier/plugins/estree')],
      };
    case 'yaml':
      return { parser: 'yaml', plugins: [await import('prettier/plugins/yaml')] };
    case 'markdown':
      return { parser: 'markdown', plugins: [await import('prettier/plugins/markdown')] };
    case 'java':
      return { parser: 'java', plugins: [(await import('prettier-plugin-java')).default] };
    default:
      throw new Error(`No formatter for subtype "${subtype}".`);
  }
}
