"use client";

import { useEffect, useRef, useState } from "react";
import {
  Page,
  Layout,
  Card,
  Box,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Button,
  ButtonGroup,
  Banner,
  DropZone,
  Icon,
  ProgressBar,
  Divider,
} from "@shopify/polaris";
import {
  XIcon,
  RemoveBackgroundIcon,
  ArrowsOutHorizontalIcon,
  AlertCircleIcon,
  ExportIcon,
  DeleteIcon,
} from "@shopify/polaris-icons";
import { formatFileSize } from "@/lib/csvSkuColors";
import { isImageFilename } from "@/lib/skuMediaZip";
import { removeImageBackground, type BgRemovalPhase } from "@/lib/backgroundRemoval";
import { mapWithConcurrency } from "@/lib/concurrency";
import { createZipBlob, type ZipWriterEntry } from "@/lib/zipWriter";
import styles from "./BgRemoverForm.module.css";

// Two at a time — each run is CPU/GPU heavy (a full segmentation pass per
// image), so more concurrency mostly just fights itself over the same cores
// rather than finishing faster.
const CONCURRENCY = 2;

type ItemStatus = "idle" | "queued" | "processing" | "done" | "error";

interface BgItem {
  id: string;
  file: File;
  previewUrl: string;
  status: ItemStatus;
  /** 0-100 within whatever phase this item is currently in. */
  percent: number;
  phase?: BgRemovalPhase;
  message?: string;
  resultBlob?: Blob;
  resultUrl?: string;
}

function outputNameFor(originalName: string): string {
  const dot = originalName.lastIndexOf(".");
  const base = dot === -1 ? originalName : originalName.slice(0, dot);
  return `${base}-no-bg.png`;
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const STATUS_DOT: Record<ItemStatus, string> = {
  idle: styles.thumbDotIdle,
  queued: styles.thumbDotIdle,
  processing: styles.thumbDotProcessing,
  done: styles.thumbDotDone,
  error: styles.thumbDotError,
};

/** A draggable left/right before-vs-after reveal for one processed image. */
function CompareSlider({ beforeUrl, afterUrl, alt }: { beforeUrl: string; afterUrl: string; alt: string }) {
  const [pos, setPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const updateFromClientX = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(100, Math.max(0, pct)));
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      updateFromClientX(e.clientX);
    };
    const handleUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, []);

  const nudge = (delta: number) => setPos((prev) => Math.min(100, Math.max(0, prev + delta)));

  return (
    <div
      ref={containerRef}
      className={styles.compare}
      onPointerDown={(e) => {
        draggingRef.current = true;
        updateFromClientX(e.clientX);
      }}
    >
      <div className={styles.compareChecker} />
      {/* eslint-disable-next-line @next/next/no-img-element -- transient client-only object URL, not a static asset Next's image pipeline can optimize */}
      <img src={afterUrl} alt={`${alt} — background removed`} className={styles.compareImg} draggable={false} />
      {/* eslint-disable-next-line @next/next/no-img-element -- transient client-only object URL */}
      <img
        src={beforeUrl}
        alt={`${alt} — original`}
        className={styles.compareImg}
        draggable={false}
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      />
      <div className={styles.compareHandle} style={{ left: `${pos}%` }}>
        <div
          className={styles.compareGrip}
          role="slider"
          tabIndex={0}
          aria-label="Compare original with background removed"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          aria-valuetext={`${Math.round(pos)}% of the original shown`}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              nudge(-5);
            }
            if (e.key === "ArrowRight") {
              e.preventDefault();
              nudge(5);
            }
            if (e.key === "Home") {
              e.preventDefault();
              setPos(0);
            }
            if (e.key === "End") {
              e.preventDefault();
              setPos(100);
            }
          }}
        >
          <Icon source={ArrowsOutHorizontalIcon} tone="inherit" />
        </div>
      </div>
      <span className={`${styles.compareLabel} ${styles.compareLabelLeft}`}>
        <Badge tone="info">Before</Badge>
      </span>
      <span className={`${styles.compareLabel} ${styles.compareLabelRight}`}>
        <Badge tone="magic">After</Badge>
      </span>
    </div>
  );
}

export function BgRemoverForm() {
  const [items, setItems] = useState<BgItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const cancelledRef = useRef(false);

  // The library's own progress reporting is coarse — it emits one tick at
  // the START of each internal step (decode/inference/mask/encode) and
  // nothing again until the next one starts. The inference step in
  // particular (the actual neural-net pass) can run 10s of seconds between
  // its own tick and the next with zero events in between — confirmed by
  // instrumenting the library directly: a 25-second real gap with nothing
  // reported. Left alone, the displayed percentage would sit frozen for
  // that entire stretch. This map creeps the DISPLAYED percent toward a
  // capped ceiling above the last REAL value whenever no real update has
  // landed recently, so the bar always keeps moving — and snaps instantly
  // to the true value the moment a real one arrives, so it never overtakes
  // or fakes past what's actually known.
  const progressRef = useRef<Map<string, { displayed: number; ceiling: number; lastRealAt: number }>>(new Map());

  // Every object URL this component has ever created (originals + results) —
  // revoked on unmount so nothing leaks past the page.
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const trackUrl = (url: string) => {
    objectUrlsRef.current.add(url);
    return url;
  };
  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  // Ticks every item currently being tracked in `progressRef` a little closer
  // to its ceiling, but only once real progress has gone quiet for a moment
  // (so it never fights with genuinely fast real updates) — an ease-out step
  // that visibly slows as it nears the ceiling without ever reaching it, so
  // there's always room left for the eventual real jump to land above it.
  useEffect(() => {
    if (!processing) return;
    const REAL_UPDATE_GRACE_MS = 500;
    const CREEP_RATE = 0.02;
    const id = setInterval(() => {
      const now = Date.now();
      const next: Record<string, number> = {};
      for (const [itemId, entry] of progressRef.current) {
        if (now - entry.lastRealAt < REAL_UPDATE_GRACE_MS) continue;
        if (entry.ceiling - entry.displayed < 0.5) continue;
        entry.displayed += (entry.ceiling - entry.displayed) * CREEP_RATE;
        next[itemId] = Math.round(entry.displayed);
      }
      if (Object.keys(next).length === 0) return;
      setItems((prev) =>
        prev.map((item) =>
          item.id in next && item.percent !== next[item.id] ? { ...item, percent: next[item.id] } : item,
        ),
      );
    }, 150);
    return () => clearInterval(id);
  }, [processing]);

  const active = items.find((item) => item.id === activeId) ?? items[0] ?? null;

  const handleDrop = (accepted: File[]) => {
    setDropError(null);
    const images = accepted.filter((f) => isImageFilename(f.name));
    if (images.length === 0) {
      setDropError("That doesn't look like an image file — try a .jpg, .png, .webp, or similar.");
      return;
    }
    const next: BgItem[] = images.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: trackUrl(URL.createObjectURL(file)),
      status: "idle",
      percent: 0,
    }));
    setItems((prev) => [...prev, ...next]);
    setActiveId((prev) => prev ?? next[0]?.id ?? prev);
    setProcessError(null);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const clearAll = () => {
    setItems([]);
    setActiveId(null);
    setDropError(null);
    setProcessError(null);
  };

  const cancelProcessing = () => {
    cancelledRef.current = true;
  };

  const processAll = async () => {
    const pending = items.filter((item) => item.status !== "done");
    if (pending.length === 0) return;
    const pendingIds = new Set(pending.map((item) => item.id));

    cancelledRef.current = false;
    setProcessError(null);
    setProcessing(true);
    // Everything in this batch is marked queued up front; each one flips to
    // "processing" only when a worker actually picks it up, so a spinner
    // never claims work that hasn't started yet.
    setItems((prev) =>
      prev.map((item) =>
        pendingIds.has(item.id)
          ? { ...item, status: "queued", percent: 0, phase: undefined, message: undefined }
          : item,
      ),
    );

    let failures = 0;
    try {
      await mapWithConcurrency(pending, CONCURRENCY, async (item) => {
        if (cancelledRef.current) return;
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "processing", percent: 0 } : i)));
        // Seeded with a little headroom so the very first stretch (before
        // the library's first tick even arrives) can creep too, not just
        // the long gaps between later ticks.
        progressRef.current.set(item.id, { displayed: 0, ceiling: 12, lastRealAt: Date.now() });
        try {
          const resultBlob = await removeImageBackground(item.file, ({ phase, percent }) => {
            const rounded = Math.round(percent);
            // A real tick just landed — snap straight to it (never lag
            // behind truth) and open a fresh ceiling above it for the creep
            // to fill while we wait for the *next* real tick.
            progressRef.current.set(item.id, {
              displayed: rounded,
              ceiling: Math.min(97, rounded + 20),
              lastRealAt: Date.now(),
            });
            setItems((prev) =>
              prev.map((i) =>
                // Skipping the update when the rounded percentage hasn't moved
                // matters: the download phase reports once per network chunk,
                // which would otherwise be hundreds of renders per file.
                i.id === item.id && (i.percent !== rounded || i.phase !== phase)
                  ? { ...i, percent: rounded, phase }
                  : i,
              ),
            );
          });
          progressRef.current.delete(item.id);
          const resultUrl = trackUrl(URL.createObjectURL(resultBlob));
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id
                ? { ...i, status: "done", percent: 100, phase: undefined, resultBlob, resultUrl }
                : i,
            ),
          );
        } catch (err) {
          progressRef.current.delete(item.id);
          failures++;
          const message = err instanceof Error ? err.message : "Couldn't remove the background.";
          setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "error", message } : i)));
        }
      });
    } finally {
      // Anything still queued or mid-flight here was cut short by Cancel —
      // put it back to idle so it can simply be run again. Any leftover
      // creep entries belong to exactly those cut-short items (every other
      // one already deleted its own entry above), so clearing the whole map
      // is safe here rather than picking through it item by item.
      progressRef.current.clear();
      setItems((prev) =>
        prev.map((i) =>
          i.status === "queued" || i.status === "processing"
            ? { ...i, status: "idle", percent: 0, phase: undefined }
            : i,
        ),
      );
      setProcessing(false);
    }

    if (cancelledRef.current) {
      setProcessError("Cancelled — anything already finished is kept.");
    } else if (failures > 0) {
      setProcessError(
        `${failures} image${failures === 1 ? "" : "s"} couldn't be processed and ${failures === 1 ? "was" : "were"} left out.`,
      );
    }
  };

  const downloadOne = (item: BgItem) => {
    if (!item.resultBlob) return;
    triggerBrowserDownload(item.resultBlob, outputNameFor(item.file.name));
  };

  const downloadAll = async () => {
    const finished = items.filter((item): item is BgItem & { resultBlob: Blob } => Boolean(item.resultBlob));
    if (finished.length === 0) return;
    if (finished.length === 1) {
      downloadOne(finished[0]);
      return;
    }
    setZipping(true);
    try {
      const entries: ZipWriterEntry[] = finished.map((item) => ({
        path: outputNameFor(item.file.name),
        blob: item.resultBlob,
      }));
      const zipBlob = await createZipBlob(entries);
      triggerBrowserDownload(zipBlob, "background-removed.zip");
    } finally {
      setZipping(false);
    }
  };

  const doneCount = items.filter((item) => item.status === "done").length;
  const errorCount = items.filter((item) => item.status === "error").length;
  const pendingCount = items.length - doneCount;
  const runningItems = items.filter((item) => item.status === "processing" || item.status === "queued");
  // Finished images count in full; whatever is mid-flight contributes its own
  // fraction, so the bar keeps moving inside a single long image too.
  const overallPercent =
    items.length === 0
      ? 0
      : Math.min(
          100,
          Math.round(
            ((doneCount + runningItems.reduce((sum, item) => sum + item.percent / 100, 0)) / items.length) * 100,
          ),
        );

  const phaseLabel = (item: BgItem) => (item.phase === "download" ? "Downloading model" : "Removing background");

  return (
    <Page
      fullWidth
      title="Background remover"
      subtitle="Personal tool — removes the background from images entirely in your browser. Nothing is uploaded anywhere; doesn't touch your store."
      backAction={{ content: "Store connection", url: "/settings/connection" }}
      titleMetadata={<Badge tone="magic">On-device</Badge>}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <Box background="bg-fill-magic" padding="200" borderRadius="200">
                  {/* Polaris's Icon has no "inverse" tone — tone="inherit" reads
                      color from the DOM ancestor, so this span is what actually
                      supplies white for a light icon on a solid fill. */}
                  <span style={{ color: "#fff", display: "flex" }}>
                    <Icon source={RemoveBackgroundIcon} tone="inherit" />
                  </span>
                </Box>
                <BlockStack gap="050">
                  <Text as="h2" variant="headingSm">Add images</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Drop one or more images — everything runs in your browser, nothing is uploaded anywhere.
                  </Text>
                </BlockStack>
              </InlineStack>

              {dropError && (
                <Banner tone="warning" title="Couldn't add that" onDismiss={() => setDropError(null)}>
                  <p>{dropError}</p>
                </Banner>
              )}

              <DropZone
                accept="image/*"
                type="file"
                allowMultiple
                onDrop={(_files, accepted) => accepted.length > 0 && handleDrop(accepted)}
              >
                <DropZone.FileUpload actionTitle="Add image(s)" actionHint="or drop one or more images" />
              </DropZone>
            </BlockStack>
          </Card>
        </Layout.Section>

        {items.length > 0 && active && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineGrid columns={{ xs: 2, sm: errorCount > 0 ? 4 : 3 }} gap="300">
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <Text as="p" variant="headingLg">{items.length}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Images added</Text>
                  </Box>
                  <Box background="bg-surface-magic" padding="300" borderRadius="200">
                    <Text as="p" variant="headingLg">{overallPercent}%</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Overall progress</Text>
                  </Box>
                  <Box background="bg-fill-success-secondary" padding="300" borderRadius="200">
                    <Text as="p" variant="headingLg">
                      {doneCount}/{items.length}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">Backgrounds removed</Text>
                  </Box>
                  {errorCount > 0 && (
                    <Box background="bg-fill-critical-secondary" padding="300" borderRadius="200">
                      <Text as="p" variant="headingLg">{errorCount}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Couldn&apos;t process</Text>
                    </Box>
                  )}
                </InlineGrid>

                <BlockStack gap="150">
                  <ProgressBar progress={overallPercent} tone="primary" size="small" />
                  <Text as="p" variant="bodySm" tone="subdued">
                    {processing
                      ? `${overallPercent}% overall — ${doneCount} of ${items.length} finished${
                          active.status === "processing" ? `, ${phaseLabel(active)} ${active.percent}%` : ""
                        }`
                      : `${doneCount} of ${items.length} finished`}
                  </Text>
                </BlockStack>

                {processError && (
                  <Banner tone={doneCount > 0 ? "warning" : "critical"} onDismiss={() => setProcessError(null)}>
                    <p>{processError}</p>
                  </Banner>
                )}

                <InlineStack align="space-between" blockAlign="center" gap="200">
                  <ButtonGroup>
                    <Button icon={DeleteIcon} onClick={clearAll} disabled={processing}>
                      Clear all
                    </Button>
                    {doneCount > 0 && (
                      <Button icon={ExportIcon} onClick={downloadAll} loading={zipping}>
                        {doneCount === 1 ? "Download image" : `Download ${doneCount} as zip`}
                      </Button>
                    )}
                  </ButtonGroup>
                  <ButtonGroup>
                    {processing && (
                      <Button tone="critical" onClick={cancelProcessing}>
                        Cancel
                      </Button>
                    )}
                    <div className={styles.magicButton}>
                      <Button
                        variant="primary"
                        icon={RemoveBackgroundIcon}
                        loading={processing}
                        disabled={processing || pendingCount === 0}
                        onClick={processAll}
                      >
                        {processing
                          ? `Removing… ${overallPercent}%`
                          : pendingCount === 0
                            ? "All done"
                            : `Remove background${pendingCount === 1 ? "" : "s"} (${pendingCount})`}
                      </Button>
                    </div>
                  </ButtonGroup>
                </InlineStack>

                <div className={styles.stageFrame}>
                  <div className={styles.stage}>
                    {active.status === "done" && active.resultUrl ? (
                      <CompareSlider beforeUrl={active.previewUrl} afterUrl={active.resultUrl} alt={active.file.name} />
                    ) : (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element -- transient client-only object URL */}
                        <img
                          src={active.previewUrl}
                          alt={active.file.name}
                          className={
                            active.status === "processing"
                              ? `${styles.stageImg} ${styles.stageImgDim}`
                              : styles.stageImg
                          }
                        />

                        {active.status === "processing" && (
                          <>
                            <div className={styles.processingScrim} />
                            <div className={styles.processingOverlay} />
                            <div className={`${styles.corner} ${styles.cornerTl}`} />
                            <div className={`${styles.corner} ${styles.cornerTr}`} />
                            <div className={`${styles.corner} ${styles.cornerBl}`} />
                            <div className={`${styles.corner} ${styles.cornerBr}`} />
                            <div className={styles.loaderWrap}>
                              <div className={styles.spinnerRing} />
                              <span className={styles.loaderPercent}>{active.percent}%</span>
                              <span className={styles.loaderLabel}>{phaseLabel(active)}</span>
                              <div className={styles.loaderBarTrack}>
                                <div className={styles.loaderBarFill} style={{ width: `${active.percent}%` }} />
                              </div>
                            </div>
                          </>
                        )}

                        {active.status === "queued" && (
                          <div className={styles.stageOverlayTop}>
                            <Badge tone="attention">Queued</Badge>
                          </div>
                        )}
                        {active.status === "idle" && (
                          <div className={styles.stageOverlayTop}>
                            <Badge tone="magic">Ready to process</Badge>
                          </div>
                        )}
                        {active.status === "error" && (
                          <div className={styles.errorOverlay}>
                            <Icon source={AlertCircleIcon} tone="critical" />
                            <Text as="p" tone="critical" variant="bodySm">
                              {active.message ?? "Couldn't remove the background."}
                            </Text>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <InlineStack align="space-between" blockAlign="center" gap="200">
                  <BlockStack gap="050">
                    <Text as="span" fontWeight="medium" breakWord>
                      {active.file.name}
                    </Text>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {formatFileSize(active.file.size)}
                    </Text>
                  </BlockStack>
                  {active.status === "done" && (
                    <Button icon={ExportIcon} onClick={() => downloadOne(active)}>
                      Download this image
                    </Button>
                  )}
                </InlineStack>

                {items.length > 1 && (
                  <>
                    <Divider />
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        All images ({items.length})
                      </Text>
                      <div className={styles.thumbstrip}>
                        {items.map((item) => (
                          <div key={item.id} className={styles.thumbWrap}>
                            <button
                              type="button"
                              className={`${styles.thumb}${item.id === active.id ? ` ${styles.thumbActive}` : ""}`}
                              onClick={() => setActiveId(item.id)}
                              aria-pressed={item.id === active.id}
                              aria-label={`Show ${item.file.name} (${item.status})`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element -- transient client-only object URL */}
                              <img src={item.previewUrl} alt="" />
                              <span className={`${styles.thumbDot} ${STATUS_DOT[item.status]}`} />
                            </button>
                            {!processing && (
                              <div className={styles.thumbRemove}>
                                <Button
                                  size="micro"
                                  icon={XIcon}
                                  variant="tertiary"
                                  accessibilityLabel={`Remove ${item.file.name}`}
                                  onClick={() => removeItem(item.id)}
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </BlockStack>
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
