export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

export function downloadCSV<T>(
  rows: T[],
  columns: CsvColumn<T>[],
  filename: string,
): void {
  if (rows.length === 0) return;

  const escape = (v: string | number | boolean | null | undefined): string => {
    const s = v == null ? '' : String(v);
    // Wrap in quotes if contains comma, newline, or quote; double up inner quotes
    return s.includes(',') || s.includes('\n') || s.includes('"')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const header = columns.map((c) => escape(c.header)).join(',');
  const body = rows
    .map((row) => columns.map((c) => escape(c.value(row))).join(','))
    .join('\n');

  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
