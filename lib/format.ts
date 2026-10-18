import type { Money } from "./shopify/types";

export function formatMoney(money: Money): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: money.currencyCode,
      maximumFractionDigits: 2,
    }).format(Number(money.amount));
  } catch {
    return `${money.amount} ${money.currencyCode}`;
  }
}

export function idFromGid(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1] ?? gid;
}
