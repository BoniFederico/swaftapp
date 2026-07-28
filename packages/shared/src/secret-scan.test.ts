import { describe, expect, it } from 'vitest';
import { hasSecretLiteral, scanForSecrets } from './secret-scan';

describe('scanForSecrets', () => {
  it('flags a literal Authorization header but not a formula one', () => {
    expect(scanForSecrets('Authorization: Bearer abcdef1234567890XYZ').map((f) => f.kind)).toEqual([
      'authorization-header',
    ]);
    expect(scanForSecrets("Authorization: Bearer ${ secret('T') }")).toEqual([]);
    expect(scanForSecrets('Authorization: Bearer {{TOKEN}}')).toEqual([]);
  });

  it('flags known token shapes', () => {
    expect(hasSecretLiteral('key = AKIAIOSFODNN7EXAMPLE')).toBe(true);
    expect(hasSecretLiteral('token: ghp_0123456789abcdefghijABCDEF')).toBe(true);
    expect(hasSecretLiteral('sk-0123456789abcdefghijABCDEFGHIJ')).toBe(true);
  });

  it('flags a high-entropy mixed string but not a UUID or a plain word', () => {
    expect(hasSecretLiteral('secret=aB3' + 'x9Q'.repeat(20))).toBe(true);
    expect(hasSecretLiteral('id: 550e8400-e29b-41d4-a716-446655440000')).toBe(false); // lowercase hex, no upper
    expect(hasSecretLiteral('the quick brown fox jumps over the lazy dog')).toBe(false);
  });

  it('ignores values inside ${ } and {{ }} placeholders', () => {
    expect(scanForSecrets("url = https://x/${ env('AKIAIOSFODNN7EXAMPLE') }")).toEqual([]);
    expect(scanForSecrets('h = {{ AKIAIOSFODNN7EXAMPLE }}')).toEqual([]);
  });

  it('redacts findings (never the full value)', () => {
    const [f] = scanForSecrets('Authorization: Bearer abcdef1234567890XYZ');
    expect(f.hint).toBe('abcd…YZ');
    expect(f.hint).not.toContain('1234567890');
  });

  it('dedupes repeated matches', () => {
    const text = 'AKIAIOSFODNN7EXAMPLE and again AKIAIOSFODNN7EXAMPLE';
    expect(scanForSecrets(text)).toHaveLength(1);
  });
});
