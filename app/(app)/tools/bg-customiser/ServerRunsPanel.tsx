"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Banner, BlockStack, Box, Button, Card, InlineStack, Modal, ProgressBar, Text } from "@shopify/polaris";
import { formatFileSize } from "@/lib/csvSkuColors";
import { bgJobs } from "@/lib/bgJobsApi";
import type { BgJobSnapshot, BgJobStatus } from "@/lib/bgJobTypes";

/** How often progress is asked for: often while something runs, rarely otherwise, and hardly at all while the tab is hidden. */
const FAST_POLL_MS = 1500;
const SLOW_POLL_MS = 10_000;
const HIDDEN_POLL_MS = 30_000;
const FAILURES_SHOWN = 8;

const isLive = (job: BgJobSnapshot): boolean => job.status === "queued" || job.status === "running";

function formatDuration(seconds: number): string {
  const total = Math.max(1, Math.round(seconds));
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
  return `${Math.floor(total / 3600)}h ${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}m`;
}

const STATUS_BADGE: Record<BgJobStatus, { tone: "info" | "success" | "attention" | "critical"; label: string }> = {
  queued: { tone: "attention", label: "Waiting" },
  running: { tone: "info", label: "Running on the server" },
  done: { tone: "success", label: "Finished" },
  cancelled: { tone: "attention", label: "Cancelled" },
  error: { tone: "critical", label: "Stopped" },
};

/** Which part of the run it is in, so the bar always means "this step" instead of jumping when the second step's size becomes known. */
function stepOf(job: BgJobSnapshot): { label: string; done: number; total: number } {
  const editing = job.done + job.failed < job.total || (job.copyTotal === 0 && job.copied === 0 && job.status !== "done");
  if (editing && job.status !== "done") return { label: "Editing images", done: job.done + Math.min(job.failed, job.total - job.done), total: job.total };
  return { label: job.copyTotal > 0 ? "Copying the rest unchanged" : "Done", done: job.copied, total: job.copyTotal };
}

function RunCard({ job, onCancel, onDelete, onRetryDownload }: { job: BgJobSnapshot; onCancel: () => void; onDelete: () => void; onRetryDownload: () => void }) {
  const badge = STATUS_BADGE[job.status];
  const step = stepOf(job);
  const percent = step.total > 0 ? Math.min(100, Math.floor((step.done / step.total) * 100)) : job.status === "done" ? 100 : 0;
  const live = isLive(job);
  return (
    <Box padding="400" background="bg-surface-secondary" borderRadius="300">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
          <BlockStack gap="050">
            <Text as="span" fontWeight="semibold" breakWord>{job.name}</Text>
            <Text as="span" variant="bodySm" tone="subdued">
              Started {new Date(job.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </Text>
          </BlockStack>
          <Badge tone={badge.tone} progress={job.status === "done" ? "complete" : live ? "partiallyComplete" : undefined}>{badge.label}</Badge>
        </InlineStack>

        {(live || job.status === "done") && (
          <BlockStack gap="150">
            <InlineStack align="space-between" blockAlign="end">
              <Text as="span" variant="headingLg">{`${percent}%`}</Text>
              <Text as="span" tone="subdued" variant="bodySm">
                {step.label}
                {step.total > 0 ? ` · ${step.done.toLocaleString()} of ${step.total.toLocaleString()}` : ""}
              </Text>
            </InlineStack>
            <ProgressBar progress={percent} size="medium" tone="primary" animated={job.status === "running"} />
          </BlockStack>
        )}

        <InlineStack gap="800" wrap>
          <Text as="span" variant="bodySm">{`${job.done.toLocaleString()} of ${job.total.toLocaleString()} edited`}</Text>
          {job.copyTotal > 0 && <Text as="span" variant="bodySm">{`${job.copied.toLocaleString()} of ${job.copyTotal.toLocaleString()} copied`}</Text>}
          {job.failed > 0 && <Text as="span" variant="bodySm" tone="critical">{`${job.failed.toLocaleString()} failed`}</Text>}
          {job.status === "running" && job.itemsPerSecond > 0 && <Text as="span" variant="bodySm" tone="subdued">{`${job.itemsPerSecond.toFixed(1)} images/s`}</Text>}
          {job.status === "running" && job.etaSeconds !== null && <Text as="span" variant="bodySm" tone="subdued">{`about ${formatDuration(job.etaSeconds)} left`}</Text>}
        </InlineStack>

        {job.status === "running" && job.current && (
          <Text as="p" variant="bodySm" tone="subdued" truncate>{job.current}</Text>
        )}
        {job.download === "preparing" && (
          <Text as="p" variant="bodySm" tone="subdued">Packing the finished images into one zip on the server (once). The download starts the moment it&apos;s ready, and if your connection drops it can be resumed.</Text>
        )}
        {job.download === "failed" && job.downloadError && <Banner tone="critical"><p>{job.downloadError}</p></Banner>}
        {live && <Text as="p" variant="bodySm" tone="subdued">The server is doing this work, so you can close this page — it keeps going until it finishes or you cancel.</Text>}
        {job.error && <Banner tone="critical"><p>{job.error}</p></Banner>}
        {job.failures.length > 0 && (
          <Banner tone="warning" title={`${job.failed.toLocaleString()} image${job.failed === 1 ? "" : "s"} couldn't be processed`}>
            <BlockStack gap="050">
              {job.failures.slice(0, FAILURES_SHOWN).map((failure) => (
                <Text key={failure.path} as="p" variant="bodySm" breakWord>{`${failure.path} — ${failure.message}`}</Text>
              ))}
              {job.failures.length > FAILURES_SHOWN && <Text as="p" variant="bodySm">…and {job.failures.length - FAILURES_SHOWN} more.</Text>}
            </BlockStack>
          </Banner>
        )}

        <InlineStack gap="200">
          {live && <Button tone="critical" onClick={onCancel}>Cancel</Button>}
          {job.download === "ready" && (
            <Button variant="primary" url={bgJobs.downloadUrl(job.id)} download>
              {job.downloadBytes ? `Download (${formatFileSize(job.downloadBytes)})` : "Download"}
            </Button>
          )}
          {job.download === "preparing" && <Button variant="primary" loading disabled>Preparing download…</Button>}
          {job.download === "failed" && <Button onClick={onRetryDownload}>Try packing the download again</Button>}
          {!live && <Button variant="plain" tone="critical" onClick={onDelete}>Delete run &amp; files</Button>}
        </InlineStack>
      </BlockStack>
    </Box>
  );
}

/**
 * Runs that live on the SERVER. They keep going when this page is closed, so this list is rebuilt from the server every
 * time the page opens: progress, Cancel while running, and a Download button once there is something to download.
 */
export function ServerRunsPanel({ refreshKey }: { refreshKey: number }) {
  const [jobs, setJobs] = useState<BgJobSnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<BgJobSnapshot | null>(null);
  const anyLive = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      if (inFlight) return;
      inFlight = true;
      bgJobs
        .list()
        .then((list) => {
          if (cancelled) return;
          anyLive.current = list.some(isLive);
          setJobs(list);
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
          if (cancelled) return;
          const delay = document.visibilityState === "hidden" ? HIDDEN_POLL_MS : anyLive.current ? FAST_POLL_MS : SLOW_POLL_MS;
          timer = setTimeout(poll, delay);
        });
    };
    // Coming back to the tab refreshes straight away instead of waiting out the slow hidden-tab delay.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshKey]);

  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      setJobs(await bgJobs.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  if (!jobs || jobs.length === 0) return error ? <Banner tone="warning"><p>{error}</p></Banner> : null;

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="050">
          <Text as="h2" variant="headingSm">Runs on the server</Text>
          <Text as="p" tone="subdued" variant="bodySm">These are done by the app itself, so they continue even if you close this page or the browser.</Text>
        </BlockStack>
        {error && <Banner tone="warning" onDismiss={() => setError(null)}><p>{error}</p></Banner>}
        {jobs.map((job) => (
          <RunCard key={job.id} job={job} onCancel={() => void act(() => bgJobs.cancel(job.id))} onDelete={() => setToDelete(job)} onRetryDownload={() => void act(() => bgJobs.prepare(job.id))} />
        ))}
      </BlockStack>

      <Modal
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="Delete this run?"
        primaryAction={{
          content: "Delete run & files",
          destructive: true,
          onAction: () => {
            const target = toDelete;
            setToDelete(null);
            if (target) void act(() => bgJobs.remove(target.id));
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setToDelete(null) }]}
      >
        <Modal.Section>
          <Text as="p">
            This deletes the run and the images it produced on the server{toDelete ? ` ("${toDelete.name}")` : ""}. Download them first if you still need them — deleted files can&apos;t be brought back.
          </Text>
        </Modal.Section>
      </Modal>
    </Card>
  );
}
