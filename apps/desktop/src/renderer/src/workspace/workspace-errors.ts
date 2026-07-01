import type { TranslationKey } from '../i18n/catalogs';

const KNOWN = new Set([
  'PASSWORD_REQUIRED',
  'WRONG_WORKSPACE_PASSWORD',
  'SCHEMA_TOO_NEW',
  'INVALID_WORKSPACE',
  'WORKSPACE_NOT_FOUND',
]);

/** Map a coded workspace error to a localized message key (falls back to a generic message). */
export function workspaceErrorKey(code: string | null): TranslationKey | null {
  if (!code) return null;
  return (KNOWN.has(code) ? `err.${code}` : 'err.generic') as TranslationKey;
}
