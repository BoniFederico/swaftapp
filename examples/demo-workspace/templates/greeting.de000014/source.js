// A capability resolves data for formulas. Call it by this template's name, e.g.
//   ${ greeting({ id: 'g', who: 'Ada' }).text }
// The call's fields arrive in `args`; whatever you return must be JSON.

export const type = 'object';

export default async function ({ args, swaft }) {
  const who = args.who ?? 'world';
  return { text: `Hello, ${who}!`, at: swaft.now() };
}
