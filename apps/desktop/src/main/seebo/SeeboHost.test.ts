import { describe, it, expect } from 'vitest';
import { SeeboHost, WIDGET_CAPABILITIES, type TemplateDataProvider } from './SeeboHost';

/** The declared type each widget's requirement must carry (its capability contract). */
const EXPECTED_WIDGET_TYPE: Record<string, string> = {
  textbox: 'string',
  textarea: 'string',
  number: 'int',
  boolean: 'bool',
  listbox: 'string',
  multiOption: 'array',
  jsonInput: 'object',
  datetimebox: 'datetime',
  durationbox: 'duration',
};

describe('SeeboHost — widget capability contracts', () => {
  it('every widget need inherits the capability contract type (no bare-string default)', async () => {
    const host = new SeeboHost();
    for (const cap of WIDGET_CAPABILITIES) {
      const a = await host.analyze(`\${ ${cap}('x') }`);
      const type = a.requirements[0]?.type as { type?: string } | undefined;
      expect(type?.type, `${cap} should contract ${EXPECTED_WIDGET_TYPE[cap]}`).toBe(
        EXPECTED_WIDGET_TYPE[cap],
      );
    }
  });

  it('a bare number() need declares an int type (so the UI guard validates it as an integer)', async () => {
    const a = await new SeeboHost().analyze("${ number('test') }");
    expect((a.requirements[0]?.type as { type?: string }).type).toBe('int');
  });
});

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
