import { describe, it, expect } from 'vitest';
import type { RenderResultDto, RequirementDto } from '@swaft/shared';
import { activeRequirements, hasInvalidInputs, validateInput } from './inputValidation';

function req(
  capability: string,
  kind: string,
  type: Partial<RequirementDto['type']> = {},
): RequirementDto {
  return {
    id: 'a',
    capability,
    label: null,
    options: null,
    type: { kind, precision: null, pattern: null, min: null, max: null, maxLength: null, ...type },
  };
}

describe('validateInput', () => {
  it('int: rejects decimals/commas, accepts integers, allows empty', () => {
    const r = req('number', 'int');
    expect(validateInput(r, '')).toBeNull();
    expect(validateInput(r, '30')).toBeNull();
    expect(validateInput(r, 30)).toBeNull();
    expect(validateInput(r, '30.5')).toEqual({ key: 'val.int' });
    expect(validateInput(r, '3,5')).toEqual({ key: 'val.int' });
  });

  it('int: enforces min/max', () => {
    const r = req('number', 'int', { min: 1, max: 10 });
    expect(validateInput(r, '0')).toEqual({ key: 'val.min', params: { n: '1' } });
    expect(validateInput(r, '11')).toEqual({ key: 'val.max', params: { n: '10' } });
    expect(validateInput(r, '5')).toBeNull();
  });

  it('float: respects precision and numeric format', () => {
    expect(validateInput(req('number', 'float', { precision: 2 }), '1.23')).toBeNull();
    expect(validateInput(req('number', 'float', { precision: 2 }), '1.234')).toEqual({
      key: 'val.precision',
      params: { n: '2' },
    });
    expect(validateInput(req('number', 'float'), 'abc')).toEqual({ key: 'val.number' });
  });

  it('duration: enforces HH:mm:ss', () => {
    const r = req('durationbox', 'duration', { pattern: 'HH:mm:ss' });
    expect(validateInput(r, '01:30:00')).toBeNull();
    expect(validateInput(r, 'garbage')).toEqual({ key: 'val.duration', params: { pattern: 'HH:mm:ss' } });
  });

  it('object: flags a leftover string (invalid JSON)', () => {
    const r = req('jsonInput', 'object');
    expect(validateInput(r, { x: 1 })).toBeNull();
    expect(validateInput(r, 'not json')).toEqual({ key: 'val.json' });
  });

  it('hasInvalidInputs aggregates across requirements', () => {
    expect(hasInvalidInputs([req('number', 'int')], { a: '30.5' })).toBe(true);
    expect(hasInvalidInputs([req('number', 'int')], { a: '30' })).toBe(false);
  });
});

describe('activeRequirements (lazy input pruning)', () => {
  const r = (id: string, capability = 'textbox'): RequirementDto => ({
    id,
    capability,
    label: null,
    options: null,
    type: null,
  });
  const res = (over: Partial<RenderResultDto>): RenderResultDto => ({
    status: 'completed',
    output: '',
    pending: [],
    diagnostics: [],
    actions: [],
    resolved: [],
    ...over,
  });

  it('falls back to the full static set before the first render', () => {
    expect(activeRequirements([r('a'), r('b')], null).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('keeps reached inputs (pending unfilled + resolved consumed), hides unreached', () => {
    const reqs = [r('shown'), r('gated'), r('filled')];
    const result = res({ status: 'waiting', pending: [r('shown')], resolved: ['filled'] });
    expect(activeRequirements(reqs, result).map((x) => x.id)).toEqual(['shown', 'filled']);
  });

  it('excludes data capabilities (e.g. template) even when reached', () => {
    expect(
      activeRequirements([r('seg'), r('cfg', 'template')], res({ resolved: ['cfg', 'seg'] })).map(
        (x) => x.id,
      ),
    ).toEqual(['seg']);
  });

  it('falls back to the full static set on a failed render (inputs stay fixable)', () => {
    expect(activeRequirements([r('a'), r('b')], res({ status: 'failed' })).map((x) => x.id)).toEqual([
      'a',
      'b',
    ]);
  });
});
