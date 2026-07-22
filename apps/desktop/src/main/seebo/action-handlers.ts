import type { SeeboActionHandler } from './seebo-module';

/**
 * Code-defined action handlers registered on every engine (`engine.defineAction`). The pure template
 * core can only *prepare* actions of these types; an unknown type can never execute. Start with a
 * safe, side-effect-free `log` handler — more handlers (HTTP, file, …) are added here as the host
 * grows.
 */
export const BUILTIN_ACTION_HANDLERS: Record<string, SeeboActionHandler> = {
  log: {
    allowedEnvironments: ['test', 'preprod', 'prod'],
    // Records only the input field names (never values) — safe and side-effect-free.
    execute: (input) => ({ logged: true, fields: Object.keys(input ?? {}) }),
  },
};

export const BUILTIN_ACTION_TYPES = Object.keys(BUILTIN_ACTION_HANDLERS);
