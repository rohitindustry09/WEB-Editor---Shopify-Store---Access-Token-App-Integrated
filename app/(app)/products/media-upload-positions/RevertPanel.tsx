"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Banner, BlockStack, Box, Button, Card, InlineStack, Modal, Text } from "@shopify/polaris";
import { formatFileSize } from "@/lib/csvSkuColors";
import { mapWithConcurrency } from "@/lib/concurrency";
import { mediaApi } from "@/lib/mediaUploadApi";
import { deleteBatch, getEntries, listBatches, markReverted, type RevertBatchSummary, type RevertEntry } from "@/lib/positionRevertStore";
import { uploadToStagedTarget } from "@/lib/stagedUpload";

const REVERT_WORKERS = 3;
const STAGE_BATCH = 50;
const MAX_ERRORS_SHOWN = 5;

type Pending = { mode: "revert" | "delete"; batch: RevertBatchSummary };
type Outcome = { tone: "success" | "warning"; title: string; errors: string[] };

const errorText = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);
const formatWhen = (ms: number): string => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Puts one product's saved pictures back into the images they came from. Returns one error line per image that couldn't be restored. */
async function restoreProduct(productId: string, entries: RevertEntry[]): Promise<{ restored: number; errors: string[] }> {
  const label = (entry: RevertEntry) => `${entry.sku} (was position ${entry.position})`;
  const errors: string[] = [];
  let restored = 0;
  try {
    for (let start = 0; start < entries.length; start += STAGE_BATCH) {
      const batch = entries.slice(start, start + STAGE_BATCH);
      const staged = await mediaApi.createStagedUploads(batch.map((e) => ({ filename: e.filename, mimeType: e.mimeType, fileSize: String(e.blob.size) })));
      if (!staged.ok || staged.targets.length !== batch.length) {
        errors.push(...batch.map((e) => `${label(e)}: ${staged.error ?? "Shopify didn't prepare the upload."}`));
        continue;
      }
      for (let i = 0; i < batch.length; i++) {
        await uploadToStagedTarget(staged.targets[i], { filename: batch[i].filename, blob: batch[i].blob, mimeType: batch[i].mimeType });
      }
      const response = await mediaApi.restoreImages(
        productId,
        batch.map((e, i) => ({ mediaId: e.mediaId, resourceUrl: staged.targets[i].resourceUrl })),
      );
      if (response.results.length === 0) errors.push(...batch.map((e) => `${label(e)}: ${response.error ?? "Shopify didn't answer."}`));
      for (const result of response.results) {
        if (result.ok) restored += 1;
        else errors.push(`${label(batch.find((e) => e.mediaId === result.mediaId) ?? batch[0])}: ${result.error ?? "Couldn't restore."}`);
      }
    }
  } catch (err) {
    errors.push(`${label(entries[0])}: ${errorText(err, "The restore failed.")}`);
  }
  return { restored, errors };
}

/** The saved revert points from earlier uploads, each one undoable. They live in this browser only. */
export function RevertPanel({ refreshKey, disabled }: { refreshKey: number; disabled: boolean }) {
  const [batches, setBatches] = useState<RevertBatchSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBatches(await listBatches());
      setLoadError(null);
    } catch (err) {
      setBatches([]);
      setLoadError(errorText(err, "Couldn't read the saved revert points."));
    }
  }, []);

  // Loads on mount and again whenever an upload finishes (refreshKey changes).
  useEffect(() => {
    let cancelled = false;
    listBatches()
      .then((list) => {
        if (cancelled) return;
        setBatches(list);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBatches([]);
        setLoadError(errorText(err, "Couldn't read the saved revert points."));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const revert = async (batch: RevertBatchSummary) => {
    setWorkingId(batch.id);
    setOutcome(null);
    try {
      const entries = (await getEntries(batch.id)).filter((e) => e.applied !== false);
      const byProduct = new Map<string, RevertEntry[]>();
      for (const entry of entries) byProduct.set(entry.productId, [...(byProduct.get(entry.productId) ?? []), entry]);
      const results = await mapWithConcurrency([...byProduct.entries()], REVERT_WORKERS, ([productId, list]) => restoreProduct(productId, list));
      const restored = results.reduce((sum, r) => sum + r.restored, 0);
      const errors = results.flatMap((r) => r.errors);
      if (errors.length === 0) await markReverted(batch.id);
      setOutcome({
        tone: errors.length === 0 ? "success" : "warning",
        title: `${restored} image${restored === 1 ? "" : "s"} restored${errors.length > 0 ? `, ${errors.length} couldn't be` : ""}`,
        errors,
      });
    } catch (err) {
      setOutcome({ tone: "warning", title: "The revert didn't finish", errors: [errorText(err, "Unknown error.")] });
    } finally {
      setWorkingId(null);
      await refresh();
    }
  };

  const remove = async (batch: RevertBatchSummary) => {
    setWorkingId(batch.id);
    try {
      await deleteBatch(batch.id);
    } catch (err) {
      setOutcome({ tone: "warning", title: "Couldn't delete the saved copies", errors: [errorText(err, "Unknown error.")] });
    } finally {
      setWorkingId(null);
      await refresh();
    }
  };

  const confirm = () => {
    const current = pending;
    setPending(null);
    if (!current) return;
    void (current.mode === "revert" ? revert(current.batch) : remove(current.batch));
  };

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingSm">Revert history</Text>
          <Text as="p" tone="subdued">
            Each upload with &ldquo;Save a copy so I can revert&rdquo; on keeps the pictures it replaced. They are stored in this browser only, so reverting works
            from this same browser and is lost if you clear site data.
          </Text>
        </BlockStack>

        {loadError && <Banner tone="warning"><p>{loadError}</p></Banner>}
        {outcome && (
          <Banner tone={outcome.tone} title={outcome.title} onDismiss={() => setOutcome(null)}>
            {outcome.errors.length > 0 && (
              <BlockStack gap="100">
                {outcome.errors.slice(0, MAX_ERRORS_SHOWN).map((line, index) => <Text key={index} as="p" variant="bodySm">{line}</Text>)}
                {outcome.errors.length > MAX_ERRORS_SHOWN && <Text as="p" variant="bodySm">…and {outcome.errors.length - MAX_ERRORS_SHOWN} more. Run the revert again to retry them.</Text>}
              </BlockStack>
            )}
          </Banner>
        )}

        {batches === null && <Text as="span" tone="subdued">Loading saved revert points…</Text>}
        {batches?.length === 0 && !loadError && <Text as="p" tone="subdued">Nothing saved yet. After your first upload, it appears here.</Text>}

        {batches?.map((batch) => (
          <Box key={batch.id} padding="300" borderWidth="025" borderColor="border" borderRadius="200">
            <InlineStack align="space-between" blockAlign="center" gap="300">
              <BlockStack gap="050">
                <Text as="span" fontWeight="medium">{batch.label}</Text>
                <Text as="span" tone="subdued" variant="bodySm">
                  {formatWhen(batch.createdAt)} · {batch.restorable} image{batch.restorable === 1 ? "" : "s"} · {formatFileSize(batch.bytes)}
                </Text>
              </BlockStack>
              <InlineStack gap="200" blockAlign="center">
                {batch.revertedAt && <Badge tone="success">{`Reverted ${formatWhen(batch.revertedAt)}`}</Badge>}
                <Button loading={workingId === batch.id} disabled={disabled || workingId !== null || batch.restorable === 0} onClick={() => setPending({ mode: "revert", batch })}>
                  {batch.revertedAt ? "Revert again" : "Revert"}
                </Button>
                <Button variant="plain" tone="critical" disabled={disabled || workingId !== null} onClick={() => setPending({ mode: "delete", batch })}>
                  Delete copies
                </Button>
              </InlineStack>
            </InlineStack>
          </Box>
        ))}
      </BlockStack>

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.mode === "delete" ? "Delete the saved copies?" : "Revert this upload?"}
        primaryAction={{ content: pending?.mode === "delete" ? "Delete copies" : "Revert images", destructive: true, onAction: confirm }}
        secondaryActions={[{ content: "Cancel", onAction: () => setPending(null) }]}
      >
        <Modal.Section>
          <Text as="p">
            {pending?.mode === "delete"
              ? "The saved pictures are removed from this browser. You won't be able to revert this upload afterwards."
              : `The ${pending?.batch.restorable ?? 0} picture${pending?.batch.restorable === 1 ? "" : "s"} saved before this upload go back into the same images on your live store, replacing what's there now. Positions and variant images are untouched.`}
          </Text>
        </Modal.Section>
      </Modal>
    </Card>
  );
}
