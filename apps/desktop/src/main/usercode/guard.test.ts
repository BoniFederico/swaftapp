import { describe, it, expect } from 'vitest';
import {
  capabilityArgs,
  findForbiddenSyntax,
  findNonJsonPath,
  isValidCapabilityName,
  normalizeCapabilityType,
  stripCommentsAndLiterals,
} from './guard';

describe('stripCommentsAndLiterals', () => {
  it('blanks comments and string bodies while preserving offsets', () => {
    const source = `const a = "import x"; // import y\nconst b = 1;`;
    const stripped = stripCommentsAndLiterals(source);
    expect(stripped).toHaveLength(source.length);
    expect(stripped).not.toContain('import');
    // Code outside literals is untouched, and line structure survives.
    expect(stripped).toContain('const a =');
    expect(stripped.split('\n')).toHaveLength(2);
  });

  it('handles escapes and template literals', () => {
    const stripped = stripCommentsAndLiterals("const s = 'it\\'s import'; const t = `import ${x}`;");
    expect(stripped).not.toContain('import');
    expect(stripped).toContain('const s =');
  });
});

describe('findForbiddenSyntax (sandbox)', () => {
  it.each([
    ["import fs from 'node:fs';", 'default import'],
    ["import { readFile } from 'node:fs';", 'named import'],
    ["import 'node:fs';", 'bare import'],
    ["import * as fs from 'node:fs';", 'namespace import'],
    ["const fs = await import('node:fs');", 'dynamic import'],
    ["const fs = require('node:fs');", 'require'],
  ])('rejects %s (%s)', (code) => {
    expect(findForbiddenSyntax(code, 'sandbox')).toBeTruthy();
  });

  it('accepts a capability that imports nothing', () => {
    const code = `export const type = 'object';\nexport default async ({ args, swaft }) => ({ id: args.id, base: swaft.env.get('B') });`;
    expect(findForbiddenSyntax(code, 'sandbox')).toBeNull();
  });

  it('does not trip over the word import inside comments or strings', () => {
    const code = `// you cannot import anything here\nconst msg = "import is unavailable";\nexport default () => msg;`;
    expect(findForbiddenSyntax(code, 'sandbox')).toBeNull();
  });

  it('does not mistake a property named import-ish for an import', () => {
    expect(findForbiddenSyntax('export default (o) => o.importantThing;', 'sandbox')).toBeNull();
  });
});

describe('capabilityArgs', () => {
  it('keeps the author fields (incl. id) and drops the engine-owned ones', () => {
    expect(
      capabilityArgs({ id: 'cfg', x: 1, capability: 'mine', type: 'object', label: 'L' }),
    ).toEqual({ id: 'cfg', x: 1 });
  });

  it('merges a nested args object so both call shapes behave alike', () => {
    expect(capabilityArgs({ id: 'cfg', capability: 'mine', args: { k: 2 } })).toEqual({
      id: 'cfg',
      k: 2,
    });
  });
});

describe('findNonJsonPath', () => {
  it('accepts JSON values', () => {
    expect(findNonJsonPath({ a: [1, 'x', true, null], b: { c: 2.5 } })).toBeNull();
  });

  it.each([
    [undefined, '$'],
    [() => 1, '$'],
    [{ a: new Date() }, '$.a'],
    [{ a: { b: new Map() } }, '$.a.b'],
    [[1, Symbol('s')], '$[1]'],
    [{ n: Number.NaN }, '$.n'],
    [{ n: Infinity }, '$.n'],
    [{ big: 1n }, '$.big'],
  ])('reports %s at its path', (value, path) => {
    expect(findNonJsonPath(value)).toBe(path);
  });

  it('reports a cycle instead of recursing forever', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(findNonJsonPath(cyclic)).toBe('$.self');
  });

  it('accepts the same object appearing twice without calling it a cycle', () => {
    const shared = { v: 1 };
    expect(findNonJsonPath({ a: shared, b: shared })).toBeNull();
  });
});

describe('names and types', () => {
  it.each(['cfg', 'myCap', '_private', '$dollar', 'a1'])('accepts %s', (name) => {
    expect(isValidCapabilityName(name)).toBe(true);
  });

  it.each(['my cap', '1cap', 'my-cap', '', 'my.cap'])('rejects %s', (name) => {
    expect(isValidCapabilityName(name)).toBe(false);
  });

  it('narrows the declared type to a Seebo base type', () => {
    expect(normalizeCapabilityType('object')).toBe('object');
    expect(normalizeCapabilityType('string')).toBe('string');
    expect(normalizeCapabilityType('Widget')).toBeNull();
    expect(normalizeCapabilityType(42)).toBeNull();
  });
});
