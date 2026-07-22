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

/** A fake `env(...)` provider over a fixed variable set (throws on a missing key, like the real one). */
function fakeEnvData(vars: Record<string, unknown>) {
  return {
    resolve: (key: string) =>
      key in vars ? Promise.resolve(vars[key]) : Promise.reject(new Error(`no env var ${key}`)),
  };
}

describe('SeeboHost — env-fallback sugar for bare names', () => {
  it('resolves an undeclared bare name from the active environment (${ pesca } ≈ ${ env(pesca) })', async () => {
    const host = new SeeboHost({}, { envData: fakeEnvData({ pesca: 'trota', base: 'api.local' }) });
    const state = await host.render('GET https://${ base }/fish/${ pesca }', {});
    expect(state.status).toBe('completed');
    expect(state.output).toBe('GET https://api.local/fish/trota');
  });

  it('keeps the original UNDECLARED_NAME diagnostic when the environment cannot resolve it', async () => {
    const host = new SeeboHost({}, { envData: fakeEnvData({ pesca: 'trota' }) });
    const state = await host.render('${ ignota }', {});
    expect(state.status).toBe('failed');
    expect(state.diagnostics?.some((d) => d.code === 'UNDECLARED_NAME')).toBe(true);
  });

  it('never falls back for string literals or names inside larger expressions', async () => {
    const host = new SeeboHost({}, { envData: fakeEnvData({ ciao: 'ENVVAL', pesca: { x: 1 } }) });
    // A string literal is a literal — even when an env var with the same name exists.
    expect((await host.render("${ 'ciao' }", {})).output).toBe('ciao');
    // Only the whole-slot bare form is sugar; expressions keep Seebo's own diagnostics.
    for (const src of ['${ pesca.x }', "${ ciao + 'y' }"]) {
      const state = await host.render(src, {});
      expect(state.status, src).toBe('failed');
      expect(state.diagnostics?.some((d) => d.code === 'UNDECLARED_NAME'), src).toBe(true);
    }
  });

  it('explicit input values win over the environment fallback', async () => {
    const host = new SeeboHost({}, { envData: fakeEnvData({ pesca: 'trota' }) });
    const state = await host.render('${ pesca }', { pesca: 'salmone' });
    expect(state.output).toBe('salmone');
  });

  it('validate() drops the diagnostic for names the environment covers (editor feedback)', async () => {
    const host = new SeeboHost({}, { envData: fakeEnvData({ pesca: 'trota' }) });
    const diags = await host.validate('${ pesca } ${ ignota }');
    expect(diags.map((d) => d.data?.name)).toEqual(['ignota']);
    // A covered name used inside an expression is NOT eligible → still flagged.
    expect((await host.validate('${ pesca + 1 }')).map((d) => d.data?.name)).toEqual(['pesca']);
  });

  it('is inert without an env provider (pure engines keep the failure)', async () => {
    const state = await new SeeboHost().render('${ pesca }', {});
    expect(state.status).toBe('failed');
  });
});

/** A fake `secret(...)` provider (returns '' for a missing name, like the real keychain-backed one). */
function fakeSecretData(secrets: Record<string, string>) {
  return { resolve: (name: string) => secrets[name] ?? '' };
}

describe('SeeboHost — secret(...) data capability', () => {
  it('is a data capability (pruned from inputs)', async () => {
    expect((await new SeeboHost().dataCapabilityNames()).has('secret')).toBe(true);
  });

  it('resolves a secret value at render time', async () => {
    const host = new SeeboHost({}, { secretData: fakeSecretData({ API_TOKEN: 't0ken' }) });
    const state = await host.render("Authorization: Bearer ${ secret('API_TOKEN') }", {});
    expect(state.status).toBe('completed');
    expect(state.output).toBe('Authorization: Bearer t0ken');
  });

  it('resolves an absent secret to empty (never crashes a preview)', async () => {
    const host = new SeeboHost({}, { secretData: fakeSecretData({}) });
    const state = await host.render("x=${ secret('MISSING') }", {});
    expect(state.status).toBe('completed');
    expect(state.output).toBe('x=');
  });

  it('is inert without a secret provider (unknown capability fails)', async () => {
    const state = await new SeeboHost().render("${ secret('X') }", {});
    expect(state.status).toBe('failed');
  });
});

describe('SeeboHost — previous(...) scenario data capability', () => {
  const ctx = (outputs: Record<string, unknown>, previousAlias?: string) => ({
    projectId: null,
    templateId: null,
    scenario: { outputs, previousAlias },
  });

  it('is a data capability (pruned from inputs), always registered', async () => {
    expect((await new SeeboHost().dataCapabilityNames()).has('previous')).toBe(true);
  });

  it('resolves an already-run block’s output envelope by alias (member access)', async () => {
    const host = new SeeboHost();
    const state = await host.render("${ previous('login').token }", {}, undefined, ctx({
      login: { token: 'abc', status: 200 },
    }));
    expect(state.status).toBe('completed');
    expect(state.output).toBe('abc');
  });

  it('resolves several prior blocks in one formula', async () => {
    const host = new SeeboHost();
    const state = await host.render(
      "${ previous('a').x }-${ previous('b').y }",
      {},
      undefined,
      ctx({ a: { x: 'one' }, b: { y: 'two' } }),
    );
    expect(state.status).toBe('completed');
    expect(state.output).toBe('one-two');
  });

  it('the whole-value form resolves to an empty object outside a run (no crash)', async () => {
    // Standalone (no scenario) → previous('x') is {}. The host resolves without throwing; a formula
    // that then reads a *property* of absent prior data is unresolved, like any missing input.
    const state = await new SeeboHost().render("${ previous('x') }", {});
    expect(state.status).toBe('completed');
  });
});
