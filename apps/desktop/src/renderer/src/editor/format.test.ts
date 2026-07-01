import { describe, it, expect } from 'vitest';
import { formatSource } from './format';

describe('formatSource', () => {
  it('formats JSON', async () => {
    const out = await formatSource('json', '{"a":1,"b":2}');
    expect(out).toContain('"a": 1');
    expect(out).toContain('"b": 2');
  });

  it('formats CSS', async () => {
    const out = await formatSource('css', 'a{color:red}');
    expect(out.replace(/\s+/g, ' ')).toContain('color: red');
  });

  it('rejects an unformattable subtype', async () => {
    await expect(formatSource('csv', 'a,b,c')).rejects.toThrow();
  });
});
