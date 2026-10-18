import { useMemo, useSyncExternalStore } from "react";
import type { FieldMapping } from "@/lib/skuApply";

/**
 * Remembers the Upload Products & Update choices in this browser so they are
 * still there next time. Column choices are stored by the CSV's header *name*
 * (not its position) so they re-apply to any CSV that has the same headers, and
 * metafields by their `namespace.key`.
 */
export interface UploadSettings {
  skuColumnHeader?: string;
  sourceKind?: "variant" | "metafield";
  /** `namespace.key` of the metafield that holds the store's SKU. */
  metafieldKey?: string;
  ignoreCase?: boolean;
  /** Field key → CSV header it is fed from; "" means "Don't change". */
  fieldHeaders?: Record<string, string>;
  statusMode?: string;
  publishMode?: string;
  workers?: number;
  /** Whether rows whose values the store already holds are skipped. */
  skipUnchanged?: boolean;
  /** Whether SKUs shared by several store products are updated too. */
  includeShared?: boolean;
  /** The stock location chosen for the inventory quantity. */
  locationId?: string;
  /** `namespace.key` → how that metafield is fed. */
  metafields?: Record<string, { header: string; fixed?: string; format?: string }>;
}

const STORAGE_KEY = "upload-products-settings-v1";
const listeners = new Set<() => void>();
/** Fallback when browser storage is blocked, so choices still survive for the page's lifetime. */
let memoryRaw = "";

function readRaw(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored;
  } catch {
    // storage blocked — use the in-memory copy
  }
  return memoryRaw;
}

function writeRaw(raw: string): void {
  memoryRaw = raw;
  try {
    if (raw === "") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // not persisted — the in-memory copy still holds it
  }
  for (const listener of listeners) listener();
}

function parseSettings(raw: string): UploadSettings {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as UploadSettings) : {};
  } catch {
    return {};
  }
}

/** The saved settings right now (not reactive) — for one-time initial state. */
export function loadUploadSettings(): UploadSettings {
  return parseSettings(readRaw());
}

/** Merges new choices into what is saved. */
export function saveUploadSettings(patch: UploadSettings): void {
  writeRaw(JSON.stringify({ ...loadUploadSettings(), ...patch }));
}

/** Forgets every saved choice. */
export function resetUploadSettings(): void {
  writeRaw("");
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Reactive saved settings — the same on server and first client render, then the saved values. */
export function useUploadSettings(): UploadSettings {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "");
  return useMemo(() => parseSettings(raw), [raw]);
}

/** Re-applies saved column choices (stored by header name) on top of the auto-detected mapping. */
export function applySavedFieldMapping(base: FieldMapping, headers: string[], savedHeaders: Record<string, string> | undefined): FieldMapping {
  const mapping: FieldMapping = { ...base };
  for (const [key, header] of Object.entries(savedHeaders ?? {})) {
    const field = key as keyof FieldMapping;
    if (header === "") {
      delete mapping[field];
      continue;
    }
    const index = headers.indexOf(header);
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}
