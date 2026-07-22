import { describe, expect, it } from 'vitest';
import { hasSeebo, hasSeeboLogic, variabilizeSeebo } from './seebo-convert';

describe('variabilizeSeebo', () => {
  it('turns env / secret / bare formulas into {{ }} variables', () => {
    expect(variabilizeSeebo("https://${ env('BASE') }/x/${ id }")).toBe('https://{{BASE}}/x/{{id}}');
    expect(variabilizeSeebo("Bearer ${ secret('TOKEN') }")).toBe('Bearer {{TOKEN}}');
  });

  it('leaves richer formulas (logic/methods/calls) untouched', () => {
    expect(variabilizeSeebo("${ region == 'eu' ? 'a' : 'b' }")).toBe("${ region == 'eu' ? 'a' : 'b' }");
    expect(variabilizeSeebo('${ name.upper() }')).toBe('${ name.upper() }');
    expect(variabilizeSeebo("${ previous('login').token }")).toBe("${ previous('login').token }");
  });
});

describe('hasSeebo / hasSeeboLogic', () => {
  it('detects any formula', () => {
    expect(hasSeebo("${ env('X') }")).toBe(true);
    expect(hasSeebo('plain text')).toBe(false);
  });

  it('flags only formulas variabilize cannot reduce', () => {
    expect(hasSeeboLogic("https://${ env('X') }/${ id }")).toBe(false); // fully variabilizable
    expect(hasSeeboLogic('${ name.upper() }')).toBe(true); // logic remains
  });
});
