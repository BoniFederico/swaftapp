import { createContext, useContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import { catalogs, en, LANGUAGES, type LanguageCode, type TranslationKey } from './catalogs';

/**
 * Minimal, typed i18n provider (UI-SPEC §23.4). Externalized string catalogs (it/en), `{{var}}`
 * interpolation, and fallback to English for missing keys. Language is a local-only preference
 * (temporary localStorage; M4 moves it to the app-level store).
 */
interface I18nContextValue {
  language: LanguageCode;
  setLanguage: (l: LanguageCode) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  languages: typeof LANGUAGES;
}

const I18nContext = createContext<I18nContextValue | null>(null);
const LS_LANG = 'swaft.language';

function readStoredLanguage(): LanguageCode {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_LANG) : null;
  return v === 'en' || v === 'it' ? v : 'en';
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
    k in vars ? String(vars[k]) : `{{${k}}}`,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(readStoredLanguage);

  const setLanguage = useCallback((l: LanguageCode) => {
    setLanguageState(l);
    try {
      localStorage.setItem(LS_LANG, l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      const table = catalogs[language] as Partial<Record<TranslationKey, string>>;
      const template = table[key] ?? en[key] ?? key;
      return interpolate(template, vars);
    },
    [language],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ language, setLanguage, t, languages: LANGUAGES }),
    [language, setLanguage, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}

/** Convenience hook returning just the translate function. */
export function useT() {
  return useI18n().t;
}
