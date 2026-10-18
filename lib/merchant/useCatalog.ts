"use client";

import { useCallback, useRef, useState } from "react";
import { loadCatalogPageAction } from "@/app/(app)/merchant/actions";
import type { CatalogFilter, CatalogRow } from "./types";

export interface CatalogState {
  rows: CatalogRow[];
  loading: boolean;
  /** True once a load finished (or was stopped) — tells "nothing loaded yet" from "nothing matched". */
  loaded: boolean;
  error: string | null;
}

const EMPTY: CatalogState = { rows: [], loading: false, loaded: false, error: null };

/** Reads the catalog page by page with a live count; Stop keeps what was read so far. */
export function useCatalog() {
  const [state, setState] = useState<CatalogState>(EMPTY);
  const stopRef = useRef(false);

  const load = useCallback(async (filter: CatalogFilter) => {
    stopRef.current = false;
    setState({ rows: [], loading: true, loaded: false, error: null });
    let cursor: string | null = null;
    let collected: CatalogRow[] = [];
    do {
      const page: Awaited<ReturnType<typeof loadCatalogPageAction>> = await loadCatalogPageAction(cursor, filter).catch(() => ({ ok: false as const, error: "Could not reach the server." }));
      if (!page.ok) {
        setState({ rows: collected, loading: false, loaded: true, error: page.error });
        return;
      }
      collected = collected.concat(page.rows);
      cursor = page.nextCursor;
      setState({ rows: collected, loading: true, loaded: false, error: null });
    } while (cursor && !stopRef.current);
    setState({ rows: collected, loading: false, loaded: true, error: null });
  }, []);

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  const reset = useCallback(() => setState(EMPTY), []);

  /** Writes changed values into the loaded rows (by variant id), so the page reflects what was just saved. */
  const patchRows = useCallback((patches: ReadonlyMap<string, Partial<CatalogRow>>) => {
    setState((prev) => ({ ...prev, rows: prev.rows.map((row) => (patches.has(row.variantId) ? { ...row, ...patches.get(row.variantId) } : row)) }));
  }, []);

  return { ...state, load, stop, reset, patchRows };
}
