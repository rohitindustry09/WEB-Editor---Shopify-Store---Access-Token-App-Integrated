/** Compares strings the way people expect — "img2" before "img10", not after. */
export function naturalCompare(a: string, b: string): number {
  const chunk = /(\d+)|(\D+)/g;
  const aParts = a.match(chunk) ?? [a];
  const bParts = b.match(chunk) ?? [b];
  const len = Math.min(aParts.length, bParts.length);

  for (let i = 0; i < len; i++) {
    const x = aParts[i];
    const y = bParts[i];
    if (x === y) continue;
    const xNum = Number(x);
    const yNum = Number(y);
    if (!Number.isNaN(xNum) && !Number.isNaN(yNum)) return xNum - yNum;
    return x < y ? -1 : 1;
  }
  return aParts.length - bParts.length;
}
