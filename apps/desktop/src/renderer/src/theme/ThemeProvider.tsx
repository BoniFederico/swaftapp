import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  PRIMARY_COLORS,
  DEFAULT_PRIMARY,
  FONTS,
  DEFAULT_FONT,
  type PrimaryColor,
  type FontOption,
} from './palette';

/**
 * ThemeProvider — single source of the active theme for all components (UI-SPEC §23.2).
 * mode: 'light' | 'dark' | 'system' (default 'system'); primaryColor: one of the 5 resolved colors.
 * Applies `data-theme` + `--primary` (with derived states via CSS color-mix) to the document root.
 *
 * Persistence is a temporary localStorage stand-in; M4 wires these to the app-level local store
 * (SWAFT_STORAGE_SYNC_MODEL.md §2.4). They are local-only preferences (never synchronized).
 */
export type ThemeMode = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  primaryColor: PrimaryColor;
  font: FontOption;
  setMode: (m: ThemeMode) => void;
  toggleMode: () => void;
  setPrimaryColor: (c: PrimaryColor) => void;
  setFont: (f: FontOption) => void;
  colors: PrimaryColor[];
  fonts: FontOption[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const LS_MODE = 'swaft.theme.mode';
const LS_PRIMARY = 'swaft.theme.primary';
const LS_FONT = 'swaft.theme.font';

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function readStoredMode(): ThemeMode {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_MODE) : null;
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

function readStoredPrimary(): PrimaryColor {
  const key = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_PRIMARY) : null;
  return PRIMARY_COLORS.find((c) => c.key === key) ?? DEFAULT_PRIMARY;
}

function readStoredFont(): FontOption {
  const key = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_FONT) : null;
  return FONTS.find((f) => f.key === key) ?? DEFAULT_FONT;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [primaryColor, setPrimaryColorState] = useState<PrimaryColor>(readStoredPrimary);
  const [font, setFontState] = useState<FontOption>(readStoredFont);
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  // Track the OS theme while in 'system' mode.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

  useEffect(() => {
    document.documentElement.style.setProperty('--primary', primaryColor.hex);
  }, [primaryColor]);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-sans', font.stack);
  }, [font]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolved,
      primaryColor,
      font,
      colors: PRIMARY_COLORS,
      fonts: FONTS,
      setMode: (m) => {
        setModeState(m);
        try {
          localStorage.setItem(LS_MODE, m);
        } catch {
          /* ignore */
        }
      },
      toggleMode: () => {
        const next: ThemeMode = resolved === 'dark' ? 'light' : 'dark';
        setModeState(next);
        try {
          localStorage.setItem(LS_MODE, next);
        } catch {
          /* ignore */
        }
      },
      setPrimaryColor: (c) => {
        setPrimaryColorState(c);
        try {
          localStorage.setItem(LS_PRIMARY, c.key);
        } catch {
          /* ignore */
        }
      },
      setFont: (f) => {
        setFontState(f);
        try {
          localStorage.setItem(LS_FONT, f.key);
        } catch {
          /* ignore */
        }
      },
    }),
    [mode, resolved, primaryColor, font],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
