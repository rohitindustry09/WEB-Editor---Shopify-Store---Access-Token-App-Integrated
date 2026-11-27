"use client";

import { useMemo, useRef, useState } from "react";
import { Banner, BlockStack, Button, Card, Checkbox, DropZone, Icon, InlineStack, Layout, Modal, Page, ProgressBar, Text } from "@shopify/polaris";
import { FileIcon, XCircleIcon } from "@shopify/polaris-icons";
import { StatTile } from "@/components/ui/StatTile";
import { WorkersField } from "@/components/WorkersField";
import { formatFileSize } from "@/lib/csvSkuColors";
import { mapWithConcurrency } from "@/lib/concurrency";
import { mediaApi } from "@/lib/mediaUploadApi";
import { uploadToStagedTarget } from "@/lib/stagedUpload";
import { backupFilename, createBatch, fetchImageBlob, saveEntry, setApplied } from "@/lib/positionRevertStore";
import { loadSkuMediaZip, readFolderImages, type SkuMediaFolder, type StreamingZipHandle } from "@/lib/skuMediaZip";
import { lookupProductsForMediaAction, type MediaSkuProduct } from "../media-upload/actions";
import { PositionRow } from "./PositionRow";
import { RevertPanel } from "./RevertPanel";
import { buildRows, replaceableSteps, rowHasProblem, type GalleryState, type PositionOutcome, type PositionRowModel, type RowResult } from "./rowModel";
import type { PositionStep } from "@/lib/positionMedia";

const DEFAULT_WORKERS = 3;
const MAX_WORKERS = 8;
const PAGE_SIZE = 50;
const GALLERY_BATCH = 100;
const STAGE_BATCH = 50;

type Filter = "all" | "ready" | "problems";
type Phase = "idle" | "scanning" | "scanned" | "uploading" | "finished";

const errorText = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);

function groupCandidates(groups: { sku: string; products: MediaSkuProduct[] }[]): Map<string, MediaSkuProduct[]> {
  const bySku = new Map<string, MediaSkuProduct[]>();
  for (const group of groups) {
    const seen = new Set<string>();
    bySku.set(group.sku, group.products.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true))));
  }
  return bySku;
}

/** Replaces one product's images at the positions its numbered files name. Throws nothing: every failure lands in the result. */
async function replaceRow(row: PositionRowModel, zip: StreamingZipHandle, signal: AbortSignal, backupBatchId: string | null): Promise<RowResult> {
  const allSteps = replaceableSteps(row);
  const product = row.product;
  if (!product || allSteps.length === 0) return { outcomes: [] };

  // Save a copy of every picture about to be overwritten. A position whose copy can't be saved is NOT replaced —
  // without the copy there would be no way back.
  const backupFailures: PositionOutcome[] = [];
  const steps: PositionStep[] = [];
  for (const step of allSteps) {
    if (!backupBatchId) {
      steps.push(step);
      continue;
    }
    try {
      const { blob, mimeType } = await fetchImageBlob(step.target!.url!, signal);
      await saveEntry({
        key: `${backupBatchId}:${step.target!.id}`,
        batchId: backupBatchId,
        productId: product.id,
        sku: row.sku,
        title: product.title,
        position: step.position,
        mediaId: step.target!.id,
        filename: backupFilename(step.target!.id, mimeType),
        mimeType,
        blob,
        applied: null,
      });
      steps.push(step);
    } catch (err) {
      backupFailures.push({ position: step.position, ok: false, error: `Not replaced — a revert copy couldn't be saved (${errorText(err, "unknown error")}).` });
    }
  }
  if (steps.length === 0) return { outcomes: backupFailures };
  const failAll = (error: string): RowResult => ({
    outcomes: [...backupFailures, ...steps.map((s) => ({ position: s.position, ok: false, error }))].sort((a, b) => a.position - b.position),
    error,
  });

  try {
    const files = await readFolderImages(zip, steps.map((s) => s.path));
    const fileByPath = new Map(files.map((f) => [f.path, f]));
    const ready = steps.filter((s) => fileByPath.has(s.path));
    const resourceUrls = new Map<number, string>();

    for (let start = 0; start < ready.length; start += STAGE_BATCH) {
      const batch = ready.slice(start, start + STAGE_BATCH);
      const batchFiles = batch.map((s) => fileByPath.get(s.path)!);
      const staged = await mediaApi.createStagedUploads(batchFiles.map((f) => ({ filename: f.filename, mimeType: f.mimeType, fileSize: String(f.blob.size) })));
      if (!staged.ok || staged.targets.length !== batchFiles.length) return failAll(staged.error ?? "Shopify didn't prepare the uploads.");
      for (let i = 0; i < batch.length; i++) {
        await uploadToStagedTarget(staged.targets[i], batchFiles[i], signal);
        resourceUrls.set(batch[i].position, staged.targets[i].resourceUrl);
      }
    }

    const items = ready.map((s) => ({ position: s.position, resourceUrl: resourceUrls.get(s.position)!, expectedMediaId: s.target!.id }));
    const response = await mediaApi.replaceAtPositions(product.id, items);
    if (response.results.length === 0) return failAll(response.error ?? "Shopify didn't answer.");
    const unread = steps.filter((s) => !fileByPath.has(s.path)).map((s) => ({ position: s.position, ok: false, error: "The file couldn't be read from the zip." }));
    if (backupBatchId) {
      const mediaIdByPosition = new Map(steps.map((s) => [s.position, s.target!.id]));
      for (const outcome of response.results) {
        const mediaId = mediaIdByPosition.get(outcome.position);
        if (mediaId) await setApplied(backupBatchId, mediaId, outcome.ok).catch(() => undefined);
      }
      for (const miss of unread) {
        const mediaId = mediaIdByPosition.get(miss.position);
        if (mediaId) await setApplied(backupBatchId, mediaId, false).catch(() => undefined);
      }
    }
    return { outcomes: [...response.results, ...unread, ...backupFailures].sort((a, b) => a.position - b.position) };
  } catch (err) {
    return failAll(signal.aborted ? "Stopped before this product finished." : errorText(err, "The upload failed."));
  }
}

/**
 * Upload media by positions: a zip of `<SKU>/<n>.jpg` where each number is the position of the product image to replace.
 * Replacement happens in place (same media item), so positions, alt text and variant images stay exactly as they were.
 */
export function PositionUploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [zip, setZip] = useState<StreamingZipHandle | null>(null);
  const [folders, setFolders] = useState<SkuMediaFolder[]>([]);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [candidates, setCandidates] = useState<Map<string, MediaSkuProduct[]>>(new Map());
  const [galleries, setGalleries] = useState<Record<string, GalleryState>>({});
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [workers, setWorkers] = useState(DEFAULT_WORKERS);
  const [filter, setFilter] = useState<Filter>("all");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [confirming, setConfirming] = useState(false);
  const [saveRevert, setSaveRevert] = useState(true);
  const [revertRefresh, setRevertRefresh] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const rows = useMemo(() => buildRows(folders, candidates, galleries, chosen), [folders, candidates, galleries, chosen]);
  const scanned = phase !== "idle" && phase !== "scanning";
  const busy = phase === "scanning" || phase === "uploading";

  const stats = useMemo(() => {
    const replaceRows = rows.filter((r) => replaceableSteps(r).length > 0);
    return {
      matched: rows.filter((r) => r.product).length,
      replaceRows,
      replacements: replaceRows.reduce((sum, r) => sum + replaceableSteps(r).length, 0),
      problems: rows.filter(rowHasProblem).length,
    };
  }, [rows]);

  const shown = useMemo(() => {
    const list = filter === "ready" ? rows.filter((r) => replaceableSteps(r).length > 0) : filter === "problems" ? rows.filter(rowHasProblem) : rows;
    return list;
  }, [rows, filter]);

  const reset = () => {
    setPhase("idle");
    setCandidates(new Map());
    setGalleries({});
    setChosen({});
    setResults({});
    setProgress({ done: 0, total: 0 });
    setFilter("all");
    setVisible(PAGE_SIZE);
  };

  const handleFile = async (picked: File) => {
    reset();
    setFile(picked);
    setZip(null);
    setFolders([]);
    setError(null);
    setParsing(true);
    try {
      const loaded = await loadSkuMediaZip(picked);
      if (loaded.folders.length === 0) throw new Error("No SKU folders with images were found. Expected folders like SKU-123/1.jpg.");
      setZip(loaded.zip);
      setFolders(loaded.folders);
    } catch (err) {
      setError(errorText(err, "Couldn't read this zip."));
      setFile(null);
    } finally {
      setParsing(false);
    }
  };

  const clearFile = () => {
    reset();
    setFile(null);
    setZip(null);
    setFolders([]);
    setError(null);
  };

  /** Matches every folder to its product, then reads each candidate's gallery so positions can be lined up. */
  const scan = async () => {
    setError(null);
    setResults({});
    setPhase("scanning");
    try {
      const lookup = await lookupProductsForMediaAction(folders.map((f) => ({ sku: f.sku, imageCount: f.imageCount })));
      if (!lookup.ok) throw new Error(lookup.error ?? "Couldn't look up the products.");
      const bySku = groupCandidates(lookup.groups);
      const productIds = [...new Set([...bySku.values()].flat().map((p) => p.id))];
      const found: Record<string, GalleryState> = {};
      for (let start = 0; start < productIds.length; start += GALLERY_BATCH) {
        const batch = await mediaApi.getOrderedMedia(productIds.slice(start, start + GALLERY_BATCH));
        for (const [id, state] of Object.entries(batch)) found[id] = state;
      }
      setCandidates(bySku);
      setGalleries(found);
      setPhase("scanned");
      setVisible(PAGE_SIZE);
    } catch (err) {
      setError(errorText(err, "The scan failed."));
      setPhase("idle");
    }
  };

  const upload = async () => {
    if (!zip) return;
    setConfirming(false);
    setError(null);
    const queue = stats.replaceRows;
    const controller = new AbortController();
    abortRef.current = controller;
    setResults({});
    setProgress({ done: 0, total: queue.length });
    let batchId: string | null = null;
    if (saveRevert) {
      try {
        batchId = (await createBatch(`${file?.name ?? "upload"} · ${stats.replacements} image${stats.replacements === 1 ? "" : "s"}`)).id;
      } catch (err) {
        setError(`${errorText(err, "Couldn't set up revert storage.")} Nothing was replaced — turn off "Save a copy so I can revert" to continue without one.`);
        return;
      }
    }
    setPhase("uploading");
    await mapWithConcurrency(queue, workers, async (row) => {
      if (controller.signal.aborted) return;
      const result = await replaceRow(row, zip, controller.signal, batchId);
      setResults((prev) => ({ ...prev, [row.sku]: result }));
      setProgress((prev) => ({ ...prev, done: prev.done + 1 }));
    });
    abortRef.current = null;
    setPhase("finished");
    setRevertRefresh((n) => n + 1);
  };

  const succeeded = Object.values(results).reduce((sum, r) => sum + r.outcomes.filter((o) => o.ok).length, 0);
  const failed = Object.values(results).reduce((sum, r) => sum + r.outcomes.filter((o) => !o.ok).length, 0);

  return (
    <Page fullWidth title="Upload media by positions" backAction={{ content: "Products", url: "/products" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingSm">Replace specific product images from a zip</Text>
              <Text as="p" tone="subdued">
                Each folder is a product SKU and each file is named with the position it replaces — <b>BT-DIYA-002/1.jpg</b> replaces the product&apos;s
                first image, <b>BT-DIYA-002/3.jpg</b> its third. Only the positions you include change; the other images are left alone. The picture is
                swapped inside the existing image, so its position, alt text and variant images stay as they are.
              </Text>
              {error && <Banner tone="critical" onDismiss={() => setError(null)}><p>{error}</p></Banner>}

              {file ? (
                <Card background="bg-surface-secondary">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Icon source={FileIcon} tone="subdued" />
                      <BlockStack gap="0">
                        <Text as="span" fontWeight="medium">{file.name}</Text>
                        <Text as="span" tone="subdued" variant="bodySm">{formatFileSize(file.size)}</Text>
                      </BlockStack>
                    </InlineStack>
                    <Button icon={XCircleIcon} variant="plain" accessibilityLabel="Remove file" disabled={busy} onClick={clearFile} />
                  </InlineStack>
                </Card>
              ) : (
                <DropZone accept=".zip,application/zip" type="file" onDrop={(_files, accepted) => accepted[0] && void handleFile(accepted[0])}>
                  <DropZone.FileUpload actionTitle="Add zip file" actionHint="or drop a .zip to upload" />
                </DropZone>
              )}

              {parsing && <Text as="span" tone="subdued">Reading zip contents…</Text>}

              {folders.length > 0 && (
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <Text as="span" tone="subdued">
                    {folders.length} SKU folder{folders.length === 1 ? "" : "s"} · {folders.reduce((sum, f) => sum + f.imageCount, 0)} image files
                  </Text>
                  <Button variant="primary" loading={phase === "scanning"} disabled={busy} onClick={() => void scan()}>
                    {scanned ? "Scan again" : "Scan and match products"}
                  </Button>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {scanned && (
          <Layout.Section>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <div className="stat-grid">
                    <StatTile value={folders.length} label="SKU folders" tone="neutral" active={filter === "all"} onClick={() => setFilter("all")} />
                    <StatTile value={stats.matched} label="Products matched" tone="success" />
                    <StatTile value={stats.replacements} label="Images to replace" tone="info" active={filter === "ready"} onClick={() => setFilter("ready")} />
                    <StatTile value={stats.problems} label="Need attention" tone={stats.problems > 0 ? "caution" : "neutral"} active={filter === "problems"} onClick={() => setFilter("problems")} />
                  </div>

                  <Checkbox
                    label="Save a copy so I can revert"
                    helpText="Keeps the current pictures in this browser before replacing them. Recommended — without it, replaced images can't be restored."
                    checked={saveRevert}
                    onChange={setSaveRevert}
                    disabled={busy}
                  />
                  <InlineStack align="space-between" blockAlign="end" gap="400">
                    <div style={{ minWidth: 220 }}>
                      <WorkersField value={workers} onChange={setWorkers} max={MAX_WORKERS} disabled={busy} helpText="Products updated at the same time" />
                    </div>
                    <InlineStack gap="300">
                      {phase === "uploading" && <Button tone="critical" onClick={() => abortRef.current?.abort()}>Stop</Button>}
                      <Button variant="primary" disabled={busy || stats.replacements === 0} loading={phase === "uploading"} onClick={() => setConfirming(true)}>
                        {`Replace ${stats.replacements} image${stats.replacements === 1 ? "" : "s"}`}
                      </Button>
                    </InlineStack>
                  </InlineStack>

                  {phase === "uploading" && (
                    <BlockStack gap="100">
                      <ProgressBar progress={progress.total ? (progress.done / progress.total) * 100 : 0} size="small" />
                      <Text as="span" tone="subdued" variant="bodySm">{progress.done} of {progress.total} products done</Text>
                    </BlockStack>
                  )}
                  {phase === "finished" && (
                    <Banner tone={failed > 0 ? "warning" : "success"} title={`${succeeded} image${succeeded === 1 ? "" : "s"} replaced${failed > 0 ? `, ${failed} failed` : ""}`}>
                      <p>
                        Shopify finishes processing the new pictures in the background, so they may take a moment to appear. Failed positions were left
                        unchanged — fix the cause and scan again to retry just those.
                      </p>
                    </Banner>
                  )}
                </BlockStack>
              </Card>

              <Card padding="0">
                {shown.length === 0 && <div style={{ padding: 16 }}><Text as="p" tone="subdued">Nothing in this filter.</Text></div>}
                {shown.slice(0, visible).map((row) => (
                  <PositionRow key={row.sku} row={row} zip={zip} result={results[row.sku]} disabled={busy} onChoose={(id) => setChosen((prev) => ({ ...prev, [row.sku]: id }))} />
                ))}
                {shown.length > visible && (
                  <div style={{ padding: 16 }}>
                    <Button onClick={() => setVisible((n) => n + PAGE_SIZE)}>{`Show more (${shown.length - visible} left)`}</Button>
                  </div>
                )}
              </Card>
            </BlockStack>
          </Layout.Section>
        )}
        <Layout.Section>
          <RevertPanel refreshKey={revertRefresh} disabled={busy} />
        </Layout.Section>
      </Layout>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Replace ${stats.replacements} image${stats.replacements === 1 ? "" : "s"}?`}
        primaryAction={{ content: "Replace images", destructive: true, onAction: () => void upload() }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirming(false) }]}
      >
        <Modal.Section>
          <Text as="p">
            This overwrites {stats.replacements} existing image{stats.replacements === 1 ? "" : "s"} across {stats.replaceRows.length} product
            {stats.replaceRows.length === 1 ? "" : "s"} in your live store. {saveRevert ? "A copy of each current picture is saved first, so you can revert from the Revert history below." : "Without a saved copy the old pictures can't be brought back."}
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
