import { useTheme, type ThemeMode } from '../theme/ThemeProvider';
import { useI18n } from '../i18n/I18nProvider';
import { Select } from '../ui';
import type { LanguageCode } from '../i18n/catalogs';

/**
 * Appearance & language controls, composed from shared components. Demonstrates that theme,
 * primary color and language are user-selectable and applied app-wide (UI-SPEC §23, PR-3).
 */
export function ThemeControls() {
  const { mode, setMode, primaryColor, setPrimaryColor, colors, font, setFont, fonts } = useTheme();
  const { t, language, setLanguage, languages } = useI18n();

  const themeOptions = [
    { value: 'system', label: t('settings.theme.system') },
    { value: 'light', label: t('settings.theme.light') },
    { value: 'dark', label: t('settings.theme.dark') },
  ];

  return (
    <div className="row" style={{ alignItems: 'flex-end', gap: 'var(--space-5)' }}>
      <Select
        label={t('settings.theme')}
        value={mode}
        options={themeOptions}
        onChange={(v) => setMode(v as ThemeMode)}
      />

      <div className="ui-field">
        <span className="ui-field__label">{t('settings.primaryColor')}</span>
        <div className="row">
          {colors.map((c) => (
            <button
              key={c.key}
              type="button"
              className="ui-swatch"
              title={c.label}
              aria-label={`primary ${c.label}`}
              aria-pressed={c.key === primaryColor.key}
              style={{ background: c.hex }}
              onClick={() => setPrimaryColor(c)}
            />
          ))}
        </div>
      </div>

      <Select
        label={t('settings.font')}
        value={font.key}
        options={fonts.map((f) => ({ value: f.key, label: f.label }))}
        onChange={(v) => {
          const next = fonts.find((f) => f.key === v);
          if (next) setFont(next);
        }}
      />

      <Select
        label={t('settings.language')}
        value={language}
        options={languages.map((l) => ({ value: l.code, label: l.label }))}
        onChange={(v) => setLanguage(v as LanguageCode)}
      />
    </div>
  );
}
