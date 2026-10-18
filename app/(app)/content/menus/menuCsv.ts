export interface MenuItemDraft {
  title: string;
  url: string;
  items: MenuItemDraft[];
}

/** Splits one CSV line into cells, honoring double-quoted cells (including an escaped `""` inside one) — a plain `split(",")` breaks the moment a label legitimately contains a comma. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/**
 * Reads a CSV laid out one top-level menu item per COLUMN: row 1 holds
 * every top-level item's label, and every row below it fills in that same
 * column's children, top to bottom — a blank cell just means that column
 * has no child at that row and is skipped, not an empty-titled item. Every
 * item, parent and child alike, gets `url: "#"` — this import is for
 * laying out menu STRUCTURE, not real links, which get filled in
 * afterward (in this app or in Shopify directly).
 */
export function parseMenuCsv(csvText: string): MenuItemDraft[] {
  const rows = csvText
    .split(/\r?\n/)
    .map(parseCsvLine)
    .filter((row) => row.some((cell) => cell.length > 0));

  if (rows.length === 0) return [];
  const [headerRow, ...bodyRows] = rows;

  const columns: MenuItemDraft[] = [];
  headerRow.forEach((title, columnIndex) => {
    if (!title) return;
    const items: MenuItemDraft[] = [];
    for (const row of bodyRows) {
      const cell = row[columnIndex];
      if (cell) items.push({ title: cell, url: "#", items: [] });
    }
    columns.push({ title, url: "#", items });
  });

  return columns;
}
