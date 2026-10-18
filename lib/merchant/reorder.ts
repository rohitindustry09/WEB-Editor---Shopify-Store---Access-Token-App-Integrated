import type { CatalogRow } from "./types";

/** Turns recent sales and current stock into "how long will it last" and "how many to order". Pure functions. */

export interface PlannerParams {
  /** How many days of sales the rate is worked out from. */
  lookbackDays: number;
  /** Days between ordering from the supplier and the stock arriving. */
  leadTimeDays: number;
  /** Days of sales the new order should cover once it arrives. */
  coverDays: number;
}

export type StockStatus = "out" | "urgent" | "soon" | "ok" | "dead";

export interface PlanRow {
  row: CatalogRow;
  sold: number;
  perDay: number;
  stock: number;
  /** Days until it sells out at the current rate (Infinity when nothing sold). */
  daysLeft: number;
  /** Units to order now; 0 when stock already covers lead time plus cover. */
  suggested: number;
  status: StockStatus;
}

const ORDER: Record<StockStatus, number> = { out: 0, urgent: 1, soon: 2, ok: 3, dead: 4 };

export function planReorder(rows: CatalogRow[], sold: ReadonlyMap<string, number>, params: PlannerParams): PlanRow[] {
  const plan: PlanRow[] = [];
  for (const row of rows) {
    // Without inventory tracking there is no stock to plan around.
    if (row.stock === null) continue;
    const units = sold.get(row.variantId) ?? 0;
    const perDay = units / Math.max(1, params.lookbackDays);
    const stock = Math.max(0, row.stock);
    const daysLeft = perDay > 0 ? stock / perDay : Number.POSITIVE_INFINITY;
    const needed = Math.ceil(perDay * (params.leadTimeDays + params.coverDays));
    const suggested = units > 0 ? Math.max(0, needed - stock) : 0;

    let status: StockStatus;
    if (units === 0) status = stock > 0 ? "dead" : "ok";
    else if (stock === 0) status = "out";
    else if (daysLeft <= params.leadTimeDays) status = "urgent";
    else if (daysLeft <= params.leadTimeDays + params.coverDays) status = "soon";
    else status = "ok";

    // "Out of stock and never sells" is not interesting; everything else stays in the list.
    if (units === 0 && stock === 0) continue;
    plan.push({ row, sold: units, perDay, stock, daysLeft, suggested, status });
  }
  return plan.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.daysLeft - b.daysLeft || b.sold - a.sold);
}

export const STATUS_LABEL: Record<StockStatus, string> = {
  out: "Out of stock — selling",
  urgent: "Reorder now",
  soon: "Reorder soon",
  ok: "Healthy",
  dead: "No sales (dead stock)",
};
