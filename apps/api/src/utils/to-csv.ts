// Neutralize CSV formula injection: a field a spreadsheet would evaluate as a
// formula (starts with =, +, -, @, or a tab/carriage-return control char) is
// prefixed with a single quote so Excel/LibreOffice treat it as literal text
// rather than executing it when the export is opened.
function neutralizeFormula(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

// RFC 4180 field escaping: quote a field when it contains the delimiter, a
// quote, or a line break, doubling any quotes inside it.
function escapeCsvField(value: string) {
  const safe = neutralizeFormula(value);
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function toCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

// Builds a CSV document (header row + one row per record) from a list of
// plain objects, in the given column order. Prefixed with a UTF-8 BOM so
// Excel opens accented and non-Latin characters correctly.
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: (keyof T & string)[],
): string {
  const lines = [columns.map(escapeCsvField).join(",")];
  for (const row of rows) {
    lines.push(
      columns.map((column) => escapeCsvField(toCell(row[column]))).join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
