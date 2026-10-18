"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Text, TextField, Icon, Pagination, Spinner } from "@shopify/polaris";
import { SearchIcon, ArrowLeftIcon, CheckIcon } from "@shopify/polaris-icons";
import { readZipImage, type StreamingZipHandle, type SkuMediaFolder } from "@/lib/skuMediaZip";

const FOLDERS_PER_PAGE = 100;
const THUMB_SIZE = 72;

/**
 * One IntersectionObserver shared by every thumbnail on the page instead of
 * one per `<img>` — with up to 100 folders × ~5 images each mounted at
 * once, that would be 500 separate observers doing the same job. Each
 * thumbnail registers a one-shot callback and unregisters itself the
 * instant it's seen, so decoding only ever happens for images actually
 * scrolled into view.
 */
function useLazyVisibility() {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const callbacksRef = useRef(new Map<Element, () => void>());

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const cb = callbacksRef.current.get(entry.target);
          if (cb) {
            cb();
            callbacksRef.current.delete(entry.target);
            observerRef.current?.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "400px" },
    );
    return () => observerRef.current?.disconnect();
  }, []);

  return useMemo(
    () => ({
      observe: (el: Element, onVisible: () => void) => {
        callbacksRef.current.set(el, onVisible);
        observerRef.current?.observe(el);
      },
      unobserve: (el: Element) => {
        callbacksRef.current.delete(el);
        observerRef.current?.unobserve(el);
      },
    }),
    [],
  );
}

type LazyThumbProps = {
  zip: StreamingZipHandle;
  path: string;
  filename: string;
  selected: boolean;
  onClick: () => void;
  observer: ReturnType<typeof useLazyVisibility>;
};

/** A single clickable thumbnail — its bytes aren't read from the zip until it actually scrolls into view, and the object URL it creates is revoked the moment it unmounts (a page change, or a folder scrolling back out via React unmounting it isn't done here — only real unmount, which is enough: the grid never mounts more than one page's worth at a time). */
function LazyThumb({ zip, path, filename, selected, onClick, observer }: LazyThumbProps) {
  const elRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    observer.observe(el, () => setVisible(true));
    return () => observer.unobserve(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- observer identity is stable (useMemo with empty deps)
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      const image = await readZipImage(zip, path);
      if (cancelled || !image) return;
      objectUrl = URL.createObjectURL(image.blob);
      setUrl(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [visible, zip, path]);

  return (
    <button
      ref={elRef}
      type="button"
      onClick={onClick}
      title={filename}
      style={{
        position: "relative",
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        flexShrink: 0,
        padding: 0,
        cursor: "pointer",
        borderRadius: 6,
        overflow: "hidden",
        background: "var(--p-color-bg-surface-secondary)",
        border: selected ? "3px solid var(--p-color-border-focus)" : "1px solid var(--p-color-border)",
        boxSizing: "border-box",
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- transient client-only object URL, decoded on demand from an in-browser zip
        <img src={url} alt={filename} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      ) : (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Spinner size="small" />
        </div>
      )}
      {selected && (
        <div
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            background: "#2c6ecb",
            borderRadius: "50%",
            width: 18,
            height: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon source={CheckIcon} tone="inherit" />
        </div>
      )}
    </button>
  );
}

type Props = {
  zip: StreamingZipHandle;
  folders: SkuMediaFolder[];
  /** Every file path that currently counts as "Column A" target, whether auto-picked by shot number or manually overridden below — the single source of truth this grid highlights against. */
  effectiveSelectedPaths: Set<string>;
  /** Clicking a thumbnail always makes it (and only it) the target for its own folder; clicking the already-selected one clears the override and falls back to the automatic shot-number pick. */
  onPick: (sku: string, path: string) => void;
  onClose: () => void;
};

/**
 * A bare, full-viewport overlay (not a real route — the zip lives only in
 * this browser tab's memory as a `File`, so a genuinely separate page would
 * have nothing to read) for visually correcting which exact image in each
 * SKU folder gets the Column A background change. Exists because neither
 * automatic approach — parsing a number out of the filename, or falling
 * back to each image's position within its folder — can be made reliable
 * against inconsistent upload-pipeline naming; eyeballing each folder is
 * the only thing that's actually 100% correct.
 */
export function BgFolderGridView({ zip, folders, effectiveSelectedPaths, onPick, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const observer = useLazyVisibility();

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const visibleFolders = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return folders;
    return folders.filter((f) => f.sku.toLowerCase().includes(query));
  }, [folders, search]);

  const pageCount = Math.max(1, Math.ceil(visibleFolders.length / FOLDERS_PER_PAGE));
  // A search that narrows the list past whatever page was showing just
  // snaps back into range — derived directly during render instead of a
  // setState-in-effect chasing every search keystroke.
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * FOLDERS_PER_PAGE;
  // Only this page's folders are ever mounted — with lazy per-thumbnail
  // decoding on top, this is what keeps a store with thousands of SKUs from
  // ever mounting more than ~100 folders' worth of DOM/thumbnails at once.
  const pageFolders = visibleFolders.slice(pageStart, pageStart + FOLDERS_PER_PAGE);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "var(--p-color-bg-surface-secondary, #f1f1f1)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          background: "var(--p-color-bg-surface, #fff)",
          borderBottom: "1px solid var(--p-color-border-secondary, #e3e3e3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            style={{ display: "flex", flexShrink: 0, background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            <Icon source={ArrowLeftIcon} tone="subdued" />
          </button>
          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <Text as="h1" variant="headingMd" truncate>
              Column A — pick the exact image per folder
            </Text>
          </div>
        </div>
        <div style={{ minWidth: 240 }}>
          <TextField
            label="Search folders"
            labelHidden
            placeholder="Search SKU folders"
            prefix={<Icon source={SearchIcon} tone="subdued" />}
            value={search}
            onChange={handleSearchChange}
            autoComplete="off"
            clearButton
            onClearButtonClick={() => handleSearchChange("")}
          />
        </div>
      </div>

      <div style={{ padding: "8px 20px", flex: 1, overflowY: "auto" }}>
        <Text as="p" tone="subdued" variant="bodySm">
          {`${visibleFolders.length.toLocaleString()} folder${visibleFolders.length === 1 ? "" : "s"} — click an image to make it that folder's Column A target; click it again to go back to the automatic pick.`}
        </Text>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
            gap: 12,
            marginTop: 12,
          }}
        >
          {pageFolders.map((folder) => (
            <div
              key={folder.sku}
              style={{
                background: "var(--p-color-bg-surface, #fff)",
                border: "1px solid var(--p-color-border-secondary, #e3e3e3)",
                borderRadius: 8,
                padding: 10,
                minWidth: 0,
              }}
            >
              <Text as="h3" variant="bodySm" fontWeight="semibold" truncate>
                {folder.sku}
              </Text>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {folder.filePaths.map((path) => {
                  const filename = path.split("/").pop() ?? path;
                  return (
                    <LazyThumb
                      key={path}
                      zip={zip}
                      path={path}
                      filename={filename}
                      selected={effectiveSelectedPaths.has(path)}
                      onClick={() => onPick(folder.sku, path)}
                      observer={observer}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {pageFolders.length === 0 && (
          <Text as="p" tone="subdued">
            No folders match &quot;{search}&quot;.
          </Text>
        )}
      </div>

      {pageCount > 1 && (
        <div
          style={{
            padding: "10px 20px",
            display: "flex",
            justifyContent: "center",
            background: "var(--p-color-bg-surface, #fff)",
            borderTop: "1px solid var(--p-color-border-secondary, #e3e3e3)",
          }}
        >
          <Pagination
            hasPrevious={currentPage > 1}
            onPrevious={() => setPage(currentPage - 1)}
            hasNext={currentPage < pageCount}
            onNext={() => setPage(currentPage + 1)}
            label={`${pageStart + 1}-${Math.min(pageStart + FOLDERS_PER_PAGE, visibleFolders.length)} of ${visibleFolders.length}`}
          />
        </div>
      )}
    </div>
  );
}
