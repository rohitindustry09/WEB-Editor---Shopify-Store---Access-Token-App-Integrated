export interface SkuColorCsvRow {
  sku: string;
  colorNames: string[];
}

/** Parses a two-column (SKU, color name) CSV, grouping color names by SKU and skipping an optional header row. */
export function parseSkuColorCsv(text: string): SkuColorCsvRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const bySku = new Map<string, string[]>();
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (i === 0 && /sku/i.test(cells[0] ?? "") && /colou?r/i.test(cells[1] ?? "")) continue;
    const [sku, colorName] = cells;
    if (!sku || !colorName) continue;
    const existing = bySku.get(sku) ?? [];
    if (!existing.some((c) => c.toLowerCase() === colorName.toLowerCase())) existing.push(colorName);
    bySku.set(sku, existing);
  }
  return Array.from(bySku.entries()).map(([sku, colorNames]) => ({ sku, colorNames }));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
