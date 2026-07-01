import type { EnvironmentOwnerKind } from '@swaft/shared';
import type { TranslationKey } from '../i18n/catalogs';

/** Localized short label for an environment's ownership, shown as a badge in the picker + settings. */
export const OWNER_KIND_LABEL: Record<EnvironmentOwnerKind, TranslationKey> = {
  user: 'env.owner.user',
  workspace: 'env.owner.workspace',
  project: 'env.owner.project',
};
