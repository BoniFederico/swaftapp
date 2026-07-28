import { describe, it, expect } from 'vitest';
import { slugify, shortId, entityBaseName } from './naming';

describe('hybrid naming', () => {
  it('slugifies human names to filesystem-safe, dash-separated lowercase', () => {
    expect(slugify('Get user')).toBe('get-user');
    expect(slugify('Billing & Payments!')).toBe('billing-payments');
    expect(slugify('  Spaced  Out  ')).toBe('spaced-out');
    expect(slugify('CamelCase')).toBe('camelcase');
    expect(slugify('café déjà')).toBe('caf-d-j'); // non-ASCII folds to separators (dependency-free)
  });

  it('falls back to a stable slug for name-less input', () => {
    expect(slugify('')).toBe('untitled');
    expect(slugify('***')).toBe('untitled');
    expect(slugify('   ')).toBe('untitled');
  });

  it('caps slug length and never leaves a trailing dash', () => {
    const long = slugify('a'.repeat(80));
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.endsWith('-')).toBe(false);
    expect(slugify(`${'word '.repeat(20)}`).endsWith('-')).toBe(false);
  });

  it('shortens ids to compact hex, stripping separators', () => {
    expect(shortId('proj-1')).toBe('proj1');
    expect(shortId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('a1b2c3d4');
    expect(shortId('SHORT')).toBe('short');
  });

  it('composes `<slug>.<shortId>` and stays deterministic', () => {
    expect(entityBaseName('Get user', 'a1b2c3d4-e5f6')).toBe('get-user.a1b2c3d4');
    expect(entityBaseName('Get user', 'a1b2c3d4-e5f6')).toBe(entityBaseName('Get user', 'a1b2c3d4-e5f6'));
    // Distinct ids never collide even with an identical slug.
    expect(entityBaseName('dup', 'id-one')).not.toBe(entityBaseName('dup', 'id-two'));
  });
});
