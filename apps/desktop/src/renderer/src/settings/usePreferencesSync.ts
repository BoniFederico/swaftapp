import { useEffect } from 'react';
import type { ApiClient } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import type { LanguageCode } from '../i18n/catalogs';
import { useTheme, type ThemeMode } from '../theme/ThemeProvider';

/**
 * Hydrate the M2 preferences (theme mode, primary color, font, language) from the app-level store
 * once after sign-in. Main is the source of truth post-M4; the localStorage stand-in from M2 remains
 * as an instant pre-paint default.
 *
 * Hydration only: changing a control applies live app-wide but is a *preview*. Persistence happens
 * exclusively when the user presses Save (Settings → Preferences, or the homepage dialog), so every
 * settings screen follows the same "nothing is stored until Save" contract.
 */
const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];
const LANGUAGES: LanguageCode[] = ['en', 'it'];

export function usePreferencesSync(client: ApiClient): void {
  const { setMode, setPrimaryColor, colors, setFont, fonts } = useTheme();
  const { setLanguage } = useI18n();

  // Hydrate once from the app-level store.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { preferences } = await client.call('prefs.get');
        if (cancelled) return;
        if (preferences.themeMode && THEME_MODES.includes(preferences.themeMode as ThemeMode)) {
          setMode(preferences.themeMode as ThemeMode);
        }
        if (preferences.primaryColor) {
          const color = colors.find((c) => c.key === preferences.primaryColor);
          if (color) setPrimaryColor(color);
        }
        if (preferences.font) {
          const next = fonts.find((f) => f.key === preferences.font);
          if (next) setFont(next);
        }
        if (preferences.language && LANGUAGES.includes(preferences.language as LanguageCode)) {
          setLanguage(preferences.language as LanguageCode);
        }
      } catch {
        /* best-effort hydration */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Hydrate once per client; the setters/lists from the providers are intentionally not triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
}
