import { useI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/catalogs';
import { EmptyState } from '../../ui';

/** Placeholder for sections that require collaboration/server mode (post-MVP). */
export function PlaceholderSettings({
  titleKey,
  hintKey,
}: {
  titleKey: TranslationKey;
  hintKey: TranslationKey;
}) {
  const { t } = useI18n();
  return <EmptyState title={t(titleKey)} hint={t(hintKey)} />;
}
