import { useI18n } from '../i18n/I18nProvider';
import type { LanguageCode } from '../i18n/catalogs';
import { Select } from '../ui';

/**
 * Standalone language selector with label and control on one row (used on the sign-in screen, where
 * theme/color are not offered).
 */
export function LanguagePicker() {
  const { t, language, setLanguage, languages } = useI18n();
  return (
    <div className="lang-row">
      <span className="ui-field__label">{t('settings.language')}</span>
      <Select
        aria-label={t('settings.language')}
        value={language}
        options={languages.map((l) => ({ value: l.code, label: l.label }))}
        onChange={(v) => setLanguage(v as LanguageCode)}
      />
    </div>
  );
}
