import type { ReactNode } from 'react';

export interface Column<Row> {
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
}

interface TableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  getRowKey: (row: Row) => string;
}

/** Shared, minimal Table. (Virtualization for large datasets arrives in M5/M9.) */
export function Table<Row>({ columns, rows, getRowKey }: TableProps<Row>) {
  return (
    <table className="ui-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={getRowKey(row)}>
            {columns.map((c) => (
              <td key={c.key}>{c.render(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
