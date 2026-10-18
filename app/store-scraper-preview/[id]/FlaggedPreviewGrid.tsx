"use client";
/* eslint-disable react-hooks/set-state-in-effect -- reading persisted overrides from localStorage after mount, so SSR and the first client render match before swapping in the saved value (same pattern as MediaUploadForm.tsx) */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Text, Spinner, ProgressBar, Icon, Pagination, Button, Checkbox } from "@shopify/polaris";
import { Select } from "@/components/ui/Select";
import { ArrowLeftIcon, RefreshIcon } from "@shopify/polaris-icons";
import type { FlaggedBackgroundImage } from "@/app/api/store-scraper/jobs/[id]/scan-backgrounds/route";
import type { CorrectedFlaggedImage } from "@/app/api/store-scraper/jobs/[id]/scan-backgrounds/verify-flagged/route";
import { loadKeptOverrides, saveKeptOverrides, overrideKey } from "@/lib/storeScraper/flaggedOverrides";
import { MAX_SCAN_WORKERS, DEFAULT_SCAN_WORKERS } from "@/lib/storeScraper/scanWorkerConstants";

const THUMB_SIZE = 50;
const POLL_INTERVAL_MS = 1500;
const VERIFY_POLL_INTERVAL_MS = 1000;
const DEFAULT_PAGE_SIZE = 100;
/** "all" shows every flagged item on a single page — no pagination controls. */
const PAGE_SIZE_OPTIONS = [
  { label: "100 per page", value: "100" },
  { label: "150 per page", value: "150" },
  { label: "200 per page", value: "200" },
  { label: "250 per page", value: "250" },
  { label: "500 per page", value: "500" },
  { label: "Show all", value: "all" },
];
const WORKER_COUNT_OPTIONS = Array.from({ length: MAX_SCAN_WORKERS }, (_, i) => {
  const count = i + 1;
  return { value: String(count), label: `${count} worker${count === 1 ? "" : "s"}` };
});

type Props = {
  jobId: string;
  hostname: string;
};

/**
 * A bare, single-purpose page — no sidebar, no nav, no cards: just the
 * flagged-images grid, live. Polls the same progress/flagged side-channel
 * the main store-scraper page's slider uses, so this reflects whatever
 * scan is running (from this tab or any other) in real time. Crossing an
 * image out here doesn't delete anything — it just tells the export "this
 * one's actually fine, keep it in the zip," persisted to localStorage so
 * it survives a reload and is respected by the actual export route too
 * (see `zipExport.ts`'s `keepOverrides` param).
 */
export function FlaggedPreviewGrid({ jobId, hostname }: Props) {
  const router = useRouter();
  const [flagged, setFlagged] = useState<FlaggedBackgroundImage[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [loaded, setLoaded] = useState(false);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  // Shopify-admin-style bulk select: "Select" turns every thumbnail into a
  // checkbox target instead of showing a cross on each one individually;
  // "Done" applies the whole batch as kept-overrides at once.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [pageSizeOption, setPageSizeOption] = useState<string>(String(DEFAULT_PAGE_SIZE));
  // "Scan the flagged items" — a second, automated way to populate
  // `selectedKeys` (alongside manually clicking thumbnails): re-checks only
  // the currently-flagged images and auto-selects whichever ones the
  // CURRENT heuristic now calls plain (a corrected false positive from an
  // older scan). Still routes through the same select-mode/Done flow so the
  // user reviews the batch before it's committed as kept.
  const [verifying, setVerifying] = useState(false);
  const [verifyProgress, setVerifyProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [workerCount, setWorkerCount] = useState(DEFAULT_SCAN_WORKERS);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const verifyPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const verifyAbortRef = useRef<AbortController | null>(null);
  // Read inside the poll's closure so pausing while selecting doesn't need
  // to rebuild the interval every time `selectMode` flips.
  const selectModeRef = useRef(selectMode);
  useEffect(() => {
    selectModeRef.current = selectMode;
  }, [selectMode]);

  useEffect(
    () => () => {
      if (verifyPollTimerRef.current) clearInterval(verifyPollTimerRef.current);
      verifyAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    setKept(loadKeptOverrides(jobId));
    const onStorage = () => setKept(loadKeptOverrides(jobId));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [jobId]);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/store-scraper/jobs/${jobId}/scan-backgrounds/progress`);
        if (res.ok) {
          const data = (await res.json()) as { done: number; total: number; flagged: FlaggedBackgroundImage[] };
          // While the user is actively selecting (manually or reviewing a
          // scan's auto-selected batch), freeze what's on screen — letting
          // the live scan reshuffle or drop thumbnails out from under a
          // pending selection is more confusing than a few seconds of
          // staleness while `selectMode` is open.
          if (!selectModeRef.current) {
            setProgress({ done: data.done, total: data.total });
            setFlagged(data.flagged);
          }
        }
      } catch {
        // A missed poll tick just tries again next interval.
      } finally {
        setLoaded(true);
      }
    };
    void poll();
    pollTimerRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [jobId]);

  /** Bypasses the select-mode pause above — used right after leaving select mode (Done or Cancel) so anything the server already changed (kept overrides, or a cancelled scan's partial cache corrections) shows up immediately instead of waiting for the next regular tick. */
  const refreshFlaggedNow = async () => {
    try {
      const res = await fetch(`/api/store-scraper/jobs/${jobId}/scan-backgrounds/progress`);
      if (res.ok) {
        const data = (await res.json()) as { done: number; total: number; flagged: FlaggedBackgroundImage[] };
        setProgress({ done: data.done, total: data.total });
        setFlagged(data.flagged);
      }
    } catch {
      // best-effort — the next regular poll tick will catch up regardless
    }
  };

  const setOverride = (key: string, isKept: boolean) => {
    setKept((prev) => {
      const next = new Set(prev);
      if (isKept) next.add(key);
      else next.delete(key);
      saveKeptOverrides(jobId, next);
      return next;
    });
  };

  const toggleSelected = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const startSelecting = () => {
    setSelectMode(true);
    setSelectedKeys(new Set());
  };

  const stopVerifyPolling = () => {
    if (verifyPollTimerRef.current) {
      clearInterval(verifyPollTimerRef.current);
      verifyPollTimerRef.current = null;
    }
  };

  const cancelSelecting = () => {
    // Stop the in-flight verify request (if any) — the route already
    // writes each image's corrected cache entry as it goes, so whatever
    // finished before this abort is real and stays; only the not-yet-
    // checked remainder is thrown away.
    verifyAbortRef.current?.abort();
    setSelectMode(false);
    setSelectedKeys(new Set());
    stopVerifyPolling();
    setVerifying(false);
    // The regular poll was paused for the whole time select mode was open —
    // refresh right away so any images the scan already corrected drop out
    // of the flagged grid immediately instead of waiting for the next tick.
    void refreshFlaggedNow();
  };

  /**
   * The automated counterpart to manually clicking thumbnails: re-checks
   * only the images currently flagged (not the whole job) against the
   * CURRENT background heuristic, and auto-selects any it now calls plain.
   * The scan cache itself gets corrected server-side too, so even if the
   * user cancels out of the review without clicking "Done," those images
   * won't come back flagged on a later poll.
   */
  const handleScanFlagged = async () => {
    if (verifying) return;
    setSelectMode(true);
    setSelectedKeys(new Set());
    setVerifying(true);
    setVerifyProgress({ done: 0, total: gridItems.length });
    const controller = new AbortController();
    verifyAbortRef.current = controller;

    const pollVerifyProgress = async () => {
      try {
        const res = await fetch(`/api/store-scraper/jobs/${jobId}/scan-backgrounds/verify-flagged/progress`);
        if (res.ok) {
          const data = (await res.json()) as { done: number; total: number };
          setVerifyProgress(data);
        }
      } catch {
        // A missed tick just tries again next interval.
      }
    };
    verifyPollTimerRef.current = setInterval(() => void pollVerifyProgress(), VERIFY_POLL_INTERVAL_MS);

    try {
      const res = await fetch(`/api/store-scraper/jobs/${jobId}/scan-backgrounds/verify-flagged?workers=${workerCount}`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { totalFlagged: number; checked: number; corrected: CorrectedFlaggedImage[] };
        setVerifyProgress({ done: data.checked, total: data.totalFlagged });
        setSelectedKeys(new Set(data.corrected.map((img) => overrideKey(img.sku, img.position))));
      }
    } catch {
      // Either a manual cancel (aborts this same request — `cancelSelecting`
      // already handles that cleanup, including refreshing the flagged
      // list) or a genuine failure. Either way, leave whatever was already
      // selected in place rather than throwing it out.
    } finally {
      verifyAbortRef.current = null;
      stopVerifyPolling();
      setVerifying(false);
    }
  };

  const finishSelecting = () => {
    setKept((prev) => {
      const next = new Set(prev);
      for (const key of selectedKeys) next.add(key);
      saveKeptOverrides(jobId, next);
      return next;
    });
    setSelectMode(false);
    setSelectedKeys(new Set());
  };

  const gridItems = flagged.filter((img) => !kept.has(overrideKey(img.sku, img.position)));
  const removedItems = flagged.filter((img) => kept.has(overrideKey(img.sku, img.position)));

  const pageSize = pageSizeOption === "all" ? gridItems.length || 1 : Number(pageSizeOption);
  const pageCount = Math.max(1, Math.ceil(gridItems.length / pageSize));
  // The grid keeps growing live as the scan finds more — if crossing an
  // item out (or the list just shrinking) leaves the current page past
  // the end, snap back to the last real page instead of showing blank.
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = gridItems.slice(pageStart, pageStart + pageSize);
  const pageRangeLabel = `${(pageStart + 1).toLocaleString()}-${Math.min(pageStart + pageSize, gridItems.length).toLocaleString()} of ${gridItems.length.toLocaleString()}`;

  return (
    <div style={{ minHeight: "100vh", background: "var(--p-color-bg-surface-secondary, #f1f1f1)", paddingBottom: removedItems.length > 0 ? 120 : 24 }}>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: "var(--p-color-bg-surface, #fff)", borderBottom: "1px solid var(--p-color-border-secondary, #e3e3e3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            style={{ display: "flex", flexShrink: 0, background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            <Icon source={ArrowLeftIcon} tone="subdued" />
          </button>
          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <Text as="h1" variant="headingMd" truncate>{`Flagged backgrounds — ${hostname}`}</Text>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {!loaded ? (
            <Spinner size="small" />
          ) : (
            <Text as="span" tone="subdued" variant="bodySm">
              {verifying || (selectMode && verifyProgress.total > 0)
                ? `${verifyProgress.done.toLocaleString()} of ${verifyProgress.total.toLocaleString()} flagged checked (${workerCount} worker${workerCount === 1 ? "" : "s"}) — ${selectedKeys.size.toLocaleString()} selected`
                : selectMode
                  ? `${selectedKeys.size.toLocaleString()} selected`
                  : `${progress.total > 0 ? `${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} images scanned — ` : ""}${gridItems.length.toLocaleString()} flagged`}
            </Text>
          )}
          {!selectMode && (
            <Select
              label="Page size"
              labelHidden
              options={PAGE_SIZE_OPTIONS}
              value={pageSizeOption}
              onChange={(value) => {
                setPageSizeOption(value);
                setPage(1);
              }}
            />
          )}
          {(!selectMode || verifying) && (
            <div style={{ minWidth: 110 }}>
              <Select
                label="Workers"
                labelHidden
                options={WORKER_COUNT_OPTIONS}
                value={String(workerCount)}
                onChange={(v) => setWorkerCount(Number(v))}
                disabled={verifying}
              />
            </div>
          )}
          {gridItems.length > 0 &&
            (selectMode ? (
              <div style={{ display: "flex", gap: 8 }}>
                <Button onClick={cancelSelecting} tone={verifying ? "critical" : undefined}>Cancel</Button>
                <Button variant="primary" disabled={selectedKeys.size === 0 || verifying} onClick={finishSelecting}>
                  Done
                </Button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <Button onClick={() => void handleScanFlagged()}>Scan the flagged items</Button>
                <Button onClick={startSelecting}>Select</Button>
              </div>
            ))}
        </div>
      </div>

      {progress.total > 0 && progress.done < progress.total && (
        <div style={{ padding: "0 20px", marginTop: 12 }}>
          <ProgressBar progress={Math.round((progress.done / progress.total) * 100)} size="small" tone="primary" />
        </div>
      )}

      {verifying && (
        <div style={{ padding: "0 20px", marginTop: 12 }}>
          <ProgressBar
            progress={verifyProgress.total > 0 ? Math.round((verifyProgress.done / verifyProgress.total) * 100) : 0}
            size="small"
            tone="primary"
          />
        </div>
      )}

      <div style={{ padding: 20 }}>
        {!loaded ? (
          <Text as="p" tone="subdued">Loading…</Text>
        ) : gridItems.length === 0 ? (
          <Text as="p" tone="subdued">
            {flagged.length === 0 ? "Nothing flagged yet." : "Everything flagged has been marked as kept — check the bar below."}
          </Text>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {pageItems.map((img) => {
                const key = overrideKey(img.sku, img.position);
                const isSelected = selectedKeys.has(key);
                return (
                  <div
                    key={key}
                    title={`${img.productName} — position ${img.position}`}
                    onClick={selectMode ? () => toggleSelected(key) : undefined}
                    style={{
                      position: "relative",
                      width: THUMB_SIZE,
                      height: THUMB_SIZE,
                      flexShrink: 0,
                      cursor: selectMode ? "pointer" : "default",
                      borderRadius: 4,
                      outline: isSelected ? "2px solid var(--p-color-border-emphasis, #2c6ecb)" : "none",
                      outlineOffset: 2,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- external, arbitrary third-party image URL */}
                    <img
                      src={img.url}
                      alt={img.productName}
                      loading="lazy"
                      style={{
                        width: THUMB_SIZE,
                        height: THUMB_SIZE,
                        objectFit: "cover",
                        borderRadius: 4,
                        display: "block",
                        opacity: selectMode && isSelected ? 0.6 : 1,
                      }}
                    />
                    {selectMode && (
                      <div style={{ position: "absolute", top: -4, left: -4, background: "#fff", borderRadius: 4 }}>
                        <Checkbox
                          label={`Select ${img.productName}`}
                          labelHidden
                          checked={isSelected}
                          onChange={() => toggleSelected(key)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {pageCount > 1 && (
              <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
                <Pagination
                  hasPrevious={currentPage > 1}
                  onPrevious={() => setPage(currentPage - 1)}
                  hasNext={currentPage < pageCount}
                  onNext={() => setPage(currentPage + 1)}
                  label={pageRangeLabel}
                />
              </div>
            )}
          </>
        )}
      </div>

      {removedItems.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            background: "var(--p-color-bg-surface, #fff)",
            borderTop: "1px solid var(--p-color-border-secondary, #e3e3e3)",
            padding: "10px 20px",
            boxShadow: "0 -2px 8px rgba(0,0,0,0.08)",
          }}
        >
          {/* Kept to one line deliberately — the outer page's bottom padding
              reserves a fixed height for this tray (see the `paddingBottom`
              above), so letting this label wrap to two lines on a narrow
              screen would grow the tray taller than that reservation and
              let it overlap the grid content above it. */}
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <Text as="span" tone="subdued" variant="bodySm">
              {`${removedItems.length.toLocaleString()} kept (won't be extracted) — click to put back`}
            </Text>
          </div>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", marginTop: 6, paddingBottom: 4 }}>
            {removedItems.map((img) => {
              const key = overrideKey(img.sku, img.position);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOverride(key, false)}
                  title={`Put ${img.productName} back in the grid`}
                  style={{ position: "relative", width: THUMB_SIZE, height: THUMB_SIZE, flexShrink: 0, padding: 0, border: "none", cursor: "pointer", background: "none" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- external, arbitrary third-party image URL */}
                  <img
                    src={img.url}
                    alt={img.productName}
                    style={{ width: THUMB_SIZE, height: THUMB_SIZE, objectFit: "cover", borderRadius: 4, display: "block", opacity: 0.6 }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(255,255,255,0.4)",
                    }}
                  >
                    <Icon source={RefreshIcon} tone="base" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
