import type { StreamingZipHandle, SkuMediaFolder } from "@/lib/skuMediaZip";

/**
 * The grid view now opens as a REAL new tab (`window.open`), not an overlay
 * in the same tab — but the zip it needs to read from only ever exists as a
 * `File` in the tab that loaded it; there's no server-side job id to hand
 * the new tab the way `store-scraper-preview/[id]` gets one. Same-origin
 * tabs can reach back into each other's live JS objects via `window.opener`
 * (no serialization, no cloning — it's the exact same `File`/`Map`
 * instances), so this bridge is stashed on `window` by the tab that has the
 * zip, and the grid tab reads it off `window.opener` instead of fetching
 * anything.
 */
export interface BgCustomiserGridBridge {
  zip: StreamingZipHandle;
  folders: SkuMediaFolder[];
  /** Always the LATEST set — the opener tab can keep checking shot-number boxes while the grid tab is open, which changes this independently of anything picked in the grid itself. */
  getSelectedPaths: () => Set<string>;
  /** Registers a listener for `getSelectedPaths()` changing; returns an unsubscribe function. */
  subscribe: (listener: (paths: Set<string>) => void) => () => void;
  onPick: (sku: string, path: string) => void;
}

export const GRID_BRIDGE_KEY = "__bgCustomiserGridBridge";

type WindowWithBridge = Window & { [GRID_BRIDGE_KEY]?: BgCustomiserGridBridge };

export function publishGridBridge(bridge: BgCustomiserGridBridge): () => void {
  (window as WindowWithBridge)[GRID_BRIDGE_KEY] = bridge;
  return () => {
    delete (window as WindowWithBridge)[GRID_BRIDGE_KEY];
  };
}

/** Only ever called from the grid tab — reads its OPENER's bridge, never its own. */
export function readGridBridgeFromOpener(): BgCustomiserGridBridge | null {
  const opener = window.opener as WindowWithBridge | null | undefined;
  return opener?.[GRID_BRIDGE_KEY] ?? null;
}
