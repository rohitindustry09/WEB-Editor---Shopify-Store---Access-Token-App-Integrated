/**
 * Parses an entire CSV document into rows of cells, honoring RFC4180
 * quoting — including a quoted cell that itself contains real newlines,
 * which is common for long description/instructions columns exported from
 * a spreadsheet. A newline is only ever treated as a row break when it
 * appears OUTSIDE an open quote; inside one it's literal cell content. A
 * doubled `""` inside an open quote is an escaped literal quote character,
 * never a boundary signal.
 *
 * This must operate on the whole document at once — a per-line parser
 * (splitting on `\n` first, then parsing each line) cannot tell a real row
 * break from a newline living inside a still-open quoted cell, and would
 * shred a multi-line cell into several bogus rows.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        current += char;
        i++;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
    } else if (char === ",") {
      row.push(current.trim());
      current = "";
      i++;
    } else if (char === "\r") {
      // Swallow bare \r and the \r in \r\n — newlines are normalized to \n row breaks below.
      i++;
    } else if (char === "\n") {
      row.push(current.trim());
      rows.push(row);
      row = [];
      current = "";
      i++;
    } else {
      current += char;
      i++;
    }
  }

  // Flush a trailing cell/row when the file doesn't end with a newline.
  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    rows.push(row);
  }

  // Drop fully-blank rows (every cell empty) — same "skip blank lines" behavior a per-line parser had.
  return rows.filter((r) => r.some((cell) => cell.length > 0));
}
