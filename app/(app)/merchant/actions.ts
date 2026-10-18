"use server";

import { fetchCatalogPage } from "@/lib/merchant/catalog";
import { deleteRun, getRunEntries, isValidRunId, listRuns, markReverted } from "@/lib/merchant/history";
import type { CatalogFilter, CatalogPage, HistoryEntry, HistoryRunSummary } from "@/lib/merchant/types";
import { getSession } from "@/lib/shopify/session";

const messageOf = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);

/** Keeps only the known filter keys, as plain strings — server actions can be called by anyone with the page open. */
function cleanFilter(raw: unknown): CatalogFilter {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const text = (value: unknown): string | undefined => (typeof value === "string" && value.length <= 200 ? value : undefined);
  const status = source.status === "ACTIVE" || source.status === "DRAFT" || source.status === "ARCHIVED" ? source.status : "";
  return { tag: text(source.tag), vendor: text(source.vendor), productType: text(source.productType), sku: text(source.sku), status };
}

/** One page of the catalog (100 variants). The client calls this in a loop so it can show live progress. */
export async function loadCatalogPageAction(cursor: string | null, filter: CatalogFilter): Promise<({ ok: true } & CatalogPage) | { ok: false; error: string }> {
  try {
    const page = await fetchCatalogPage(typeof cursor === "string" ? cursor : null, cleanFilter(filter));
    return { ok: true, ...page };
  } catch (err) {
    return { ok: false, error: messageOf(err, "Couldn't read the catalog from the store.") };
  }
}

export async function listRunsAction(): Promise<{ ok: true; runs: HistoryRunSummary[] } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not connected to a store." };
  return { ok: true, runs: await listRuns(session.shop) };
}

export async function getRunEntriesAction(runId: string): Promise<{ ok: true; entries: HistoryEntry[] } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session || !isValidRunId(runId)) return { ok: false, error: "That run couldn't be found." };
  const entries = await getRunEntries(session.shop, runId);
  return entries ? { ok: true, entries } : { ok: false, error: "That run couldn't be found." };
}

export async function markRunRevertedAction(runId: string): Promise<void> {
  const session = await getSession();
  if (session && isValidRunId(runId)) await markReverted(session.shop, runId);
}

export async function deleteRunAction(runId: string): Promise<void> {
  const session = await getSession();
  if (session && isValidRunId(runId)) await deleteRun(session.shop, runId);
}
