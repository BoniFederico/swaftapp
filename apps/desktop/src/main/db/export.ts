/** Serialize a query result to CSV / JSON for export (SWAFT_DATA_MODEL §13). */

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: string[], rows: unknown[][]): string {
  const header = columns.map(csvCell).join(',');
  const body = rows.map((row) => row.map(csvCell).join(','));
  return [header, ...body].join('\n');
}

export function toJson(columns: string[], rows: unknown[][]): string {
  const records = rows.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i] ?? null])));
  return JSON.stringify(records, null, 2);
}
