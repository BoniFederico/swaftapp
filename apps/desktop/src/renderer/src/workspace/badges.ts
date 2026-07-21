import type { TemplateSummary } from '@swaft/shared';

/** Per-subtype / per-HTTP-method badge colors (always the same color for a given value). */
const BADGE_COLORS: Record<string, string> = {
  html: '#e34c26',
  markdown: '#4078c0',
  css: '#2965f1',
  javascript: '#c9a227',
  capability: '#00897b',
  action: '#e8590c',
  scenario: '#7c3aed',
  java: '#b07219',
  json: '#3f9d3f',
  yaml: '#cb171e',
  csv: '#1a9c4f',
  eml: '#7c6f9c',
  text: '#6b7280',
  swagger: '#5aa700',
  mermaid: '#9333ea',
  echarts: '#c1232b',
  GET: '#1a9c4f',
  POST: '#c9810a',
  PUT: '#2563c9',
  PATCH: '#8b5cf6',
  DELETE: '#dd3333',
  HEAD: '#0891b2',
  OPTIONS: '#6b7280',
};

export const badgeColor = (value: string): string => BADGE_COLORS[value] ?? 'var(--text-muted)';

/**
 * The small badge shown on a template row: the HTTP method for APIs, the kind for user code (whose
 * subtype is always "javascript", which would make a capability and an action look identical), else
 * the subtype. Shared by the Working Tree rows and the folder content cards.
 */
export function rowBadge(tpl: TemplateSummary): string | null {
  if (tpl.type === 'api') return tpl.method ?? 'GET';
  if (tpl.type === 'capability' || tpl.type === 'action' || tpl.type === 'scenario') return tpl.type;
  return tpl.subtype;
}
