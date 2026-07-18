/**
 * The 5 resolved primary colors (default Blue) — see SWAFT_UI_SPEC.md §23.3 (OD-UI-7 resolved).
 */
export interface PrimaryColor {
  key: string;
  label: string;
  hex: string;
}

export const PRIMARY_COLORS: PrimaryColor[] = [
  { key: 'blue', label: 'Blue', hex: '#3574F0' },
  { key: 'indigo', label: 'Indigo', hex: '#6750A4' },
  { key: 'teal', label: 'Teal', hex: '#0D9488' },
  { key: 'green', label: 'Green', hex: '#16A34A' },
  { key: 'amber', label: 'Amber', hex: '#F59E0B' },
];

export const DEFAULT_PRIMARY: PrimaryColor = PRIMARY_COLORS[0];

/** UI font choices (applied via the `--font-sans` token). */
export interface FontOption {
  key: string;
  label: string;
  stack: string;
}

export const FONTS: FontOption[] = [
  { key: 'inter', label: 'Inter', stack: "'Inter Variable', 'Inter', system-ui, sans-serif" },
  {
    key: 'system',
    label: 'System',
    stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  { key: 'mono', label: 'Mono', stack: "ui-monospace, 'JetBrains Mono', SFMono-Regular, monospace" },
];

export const DEFAULT_FONT: FontOption = FONTS[0];
