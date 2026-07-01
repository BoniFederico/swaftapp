/**
 * Parse a swagger/echarts spec from a render output. Accepts JSON or YAML (OpenAPI specs are commonly
 * written in YAML), so a valid spec in either form renders. Returns null for empty input.
 */
export async function parseSpec(source: string): Promise<unknown> {
  const text = source.trim();
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    const yaml = await import('js-yaml');
    return yaml.load(text);
  }
}
