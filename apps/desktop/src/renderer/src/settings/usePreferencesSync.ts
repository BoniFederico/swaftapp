import { useEffect, useRef } from 'react';
import type { ApiClient } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import type { LanguageCode } from '../i18n/catalogs';
import { useTheme, type ThemeMode } from '../theme/ThemeProvider';

/**
 * Persist the M2 preferences (theme mode, primary color, language) to the app-level store via the
 * API client, and hydrate them once after sign-in. Main is the source of truth post-M4; the
 * localStorage stand-in from M2 remains as an instant pre-paint default. Best-effort: persistence
 * failures (e.g. before the backend is ready) are ignored. See SWAFT_STORAGE_SYNC_MODEL.md §2.4.
 */
const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];
const LANGUAGES: LanguageCode[] = ['en', 'it'];

export function usePreferencesSync(client: ApiClient): void {
  const { mode, setMode, primaryColor, setPrimaryColor, colors, font, setFont, fonts } = useTheme();
  const { language, setLanguage } = useI18n();
  const hydrated = useRef(false);

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
      } finally {
        hydrated.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Persist on change (after hydration, to avoid echoing the hydrated values back).
  useEffect(() => {
    if (!hydrated.current) return;
    void client
      .call('prefs.set', {
        themeMode: mode,
        primaryColor: primaryColor.key,
        font: font.key,
        language,
      })
      .catch(() => undefined);
  }, [client, mode, primaryColor, font, language]);
}
