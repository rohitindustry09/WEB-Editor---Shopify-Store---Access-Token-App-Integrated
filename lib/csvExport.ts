/** Quotes a CSV field only when it needs it — commas, quotes, or newlines — escaping embedded quotes as `""`. */
function toCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Builds an RFC4180-ish CSV string (header + rows) from a header row and cell rows. */
export function buildCsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((row) => row.map(toCsvField).join(",")).join("\r\n");
}

/** Triggers a browser download of a CSV string as a named file. */
export function downloadCsv(csv: string, filename: string): void {
  // A UTF-8 BOM keeps Excel from mangling non-ASCII tag/title text.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
