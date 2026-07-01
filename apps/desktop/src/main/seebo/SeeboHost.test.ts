import { describe, it, expect } from 'vitest';
import { SeeboHost, type TemplateDataProvider } from './SeeboHost';

/** A fake `template(...)` provider returning a fixed JSON object, ignoring project scope. */
function fakeTemplateData(obj: unknown): TemplateDataProvider {
  return { resolve: async () => obj };
}

describe('SeeboHost — template data capability', () => {
  it('resolves member access on template(...) without the template declaring type:object()', async () => {
    const host = new SeeboHost({}, { templateData: fakeTemplateData({ data: 'hello', baseUrl: 'x' }) });

    // No `type:object()` in the template: the capability contract (type:'object') supplies it, so the
    // JSON object is not rejected as an invalid string (the old CAPABILITY_INVALID_VALUE).
    const state = await host.render("${ template('cfg').data }", {});

    expect(state.status).toBe('completed');
    expect(state.output).toBe('hello');
  });

  it('supports the string(...) coercion form too', async () => {
    const host = new SeeboHost({}, { templateData: fakeTemplateData({ data: 42 }) });
    const state = await host.render("${ string(template('cfg').data) }", {});
    expect(state.status).toBe('completed');
    expect(state.output).toBe('42');
  });
});
