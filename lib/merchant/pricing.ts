import type { CatalogRow } from "./types";

/** How a bulk price change is worked out. Pure functions — no store access — so the preview is instant. */

export type PriceMode = "percent" | "amount" | "set" | "sale" | "endSale";
export type PriceTarget = "price" | "compareAt";
export type Rounding = "none" | "99" | "95" | "whole";

export interface PriceRule {
  mode: PriceMode;
  /** Percent, amount or the fixed price, depending on the mode (unused by "endSale"). */
  value: number;
  target: PriceTarget;
  rounding: Rounding;
  /** Prices are never set below this (0 = no floor). */
  floor: number;
}

export interface PricePair {
  price: string;
  compareAtPrice: string | null;
}

const toMoney = (value: number): string => value.toFixed(2);

/** Applies the rounding style to a price; ".99" and ".95" never push a price up to the next whole number. */
export function roundPrice(value: number, rounding: Rounding): number {
  switch (rounding) {
    case "99":
      return value < 1 ? value : Math.floor(value) + 0.99;
    case "95":
      return value < 1 ? value : Math.floor(value) + 0.95;
    case "whole":
      return Math.round(value);
    default:
      return Math.round(value * 100) / 100;
  }
}

/** The price a variant is "really" at before any sale: its compare-at price when it is on sale, else its price. */
const regularPrice = (price: number, compareAt: number | null): number => (compareAt !== null && compareAt > price ? compareAt : price);

/**
 * What this variant's prices become under the rule, or null when nothing would change (or the rule doesn't
 * apply to it — e.g. "end sale" on a variant that is not on sale).
 */
export function computePrices(row: Pick<CatalogRow, "price" | "compareAtPrice">, rule: PriceRule): PricePair | null {
  const price = Number(row.price);
  const compareAt = row.compareAtPrice === null ? null : Number(row.compareAtPrice);
  if (!Number.isFinite(price) || (compareAt !== null && !Number.isFinite(compareAt))) return null;
  const floor = Math.max(0, rule.floor);
  const clamp = (value: number): number => Math.max(floor, Math.max(0, value));

  let next: PricePair;
  if (rule.mode === "endSale") {
    if (compareAt === null || compareAt <= price) return null;
    next = { price: toMoney(compareAt), compareAtPrice: null };
  } else if (rule.mode === "sale") {
    const base = regularPrice(price, compareAt);
    const sale = clamp(roundPrice(base * (1 - rule.value / 100), rule.rounding));
    if (sale >= base) return null;
    next = { price: toMoney(sale), compareAtPrice: toMoney(base) };
  } else if (rule.target === "compareAt") {
    if (compareAt === null) return null;
    const raw = rule.mode === "percent" ? compareAt * (1 + rule.value / 100) : rule.mode === "amount" ? compareAt + rule.value : rule.value;
    next = { price: row.price, compareAtPrice: toMoney(clamp(roundPrice(raw, rule.rounding))) };
  } else {
    const raw = rule.mode === "percent" ? price * (1 + rule.value / 100) : rule.mode === "amount" ? price + rule.value : rule.value;
    next = { price: toMoney(clamp(roundPrice(raw, rule.rounding))), compareAtPrice: row.compareAtPrice };
  }

  const unchanged = Number(next.price) === price && (next.compareAtPrice === null ? compareAt === null : compareAt !== null && Number(next.compareAtPrice) === compareAt);
  return unchanged ? null : next;
}

/** A readable one-line description of the rule, used to label the run in the history. */
export function describeRule(rule: PriceRule): string {
  const sign = rule.value >= 0 ? "+" : "−";
  const size = Math.abs(rule.value);
  const what = rule.target === "compareAt" ? "compare-at price" : "price";
  switch (rule.mode) {
    case "percent":
      return `${sign}${size}% on ${what}`;
    case "amount":
      return `${sign}${size} on ${what}`;
    case "set":
      return `Set ${what} to ${size}`;
    case "sale":
      return `Sale: ${size}% off`;
    case "endSale":
      return "End sale (restore regular price)";
  }
}
