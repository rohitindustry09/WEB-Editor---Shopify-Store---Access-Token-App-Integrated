"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Banner, BlockStack, Box, Button, Icon, InlineStack, ProgressBar, Text, TextField } from "@shopify/polaris";
import { FileIcon } from "@shopify/polaris-icons";
import { formatFileSize } from "@/lib/csvSkuColors";
import type { DriveJobSnapshot } from "@/lib/driveJobTypes";
import { driveJobs, remoteSourceOf } from "@/lib/driveJobsApi";
import { parseDriveLink } from "@/lib/googleDrive";
import type { RemoteZipSource } from "@/lib/skuMediaZip";

const FAST_POLL_MS = 1000;
const SLOW_POLL_MS = 10_000;
const HIDDEN_POLL_MS = 30_000;

const isActive = (job: DriveJobSnapshot): boolean => job.status === "starting" || job.status === "downloading";
const percentOf = (job: DriveJobSnapshot): number => (job.total ? Math.min(100, Math.floor((job.received / job.total) * 100)) : 0);

function formatDuration(seconds: number): string {
  const total = Math.max(1, Math.round(seconds));
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
  return `${Math.floor(total / 3600)}h ${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}m`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <BlockStack gap="050">
      <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
      <Text as="span" variant="headingSm">{value}</Text>
    </BlockStack>
  );
}

function FileHeading({ name, size, badge }: { name: string | null; size: number | null; badge: ReactNode }) {
  return (
    <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
      <InlineStack gap="300" blockAlign="center" wrap={false}>
        <Icon source={FileIcon} tone="subdued" />
        <BlockStack gap="0">
          <Text as="span" fontWeight="semibold" breakWord>{name ?? "Contacting Google Drive…"}</Text>
          {size !== null && <Text as="span" variant="bodySm" tone="subdued">{formatFileSize(size)}</Text>}
        </BlockStack>
      </InlineStack>
      {badge}
    </InlineStack>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <Box padding="400" background="bg-surface-secondary" borderRadius="300">
      <BlockStack gap="400">{children}</BlockStack>
    </Box>
  );
}

/** A download that's running on the server: name, big percentage, bar, speed / time left / connections. */
function RunningCard({ job, onPause }: { job: DriveJobSnapshot; onPause: () => void }) {
  const starting = job.status === "starting";
  const percent = percentOf(job);
  return (
    <Card>
      <FileHeading name={job.name} size={job.total} badge={<Badge tone="info" progress="partiallyComplete">{starting ? "Connecting" : "Downloading on the server"}</Badge>} />
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="end">
          <Text as="span" variant="heading2xl">{job.total ? `${percent}%` : "—"}</Text>
          <Text as="span" tone="subdued">
            {formatFileSize(job.received)}
            {job.total ? ` of ${formatFileSize(job.total)}` : ""}
          </Text>
        </InlineStack>
        <ProgressBar progress={starting ? 0 : percent} size="medium" tone="primary" animated />
      </BlockStack>
      <InlineStack gap="800" wrap>
        <Stat label="Server speed" value={job.bytesPerSecond > 0 ? `${formatFileSize(job.bytesPerSecond)}/s` : "—"} />
        <Stat label="Time left" value={job.etaSeconds !== null ? formatDuration(job.etaSeconds) : "—"} />
        <Stat label="Connections" value={job.connections > 0 ? String(job.connections) : "—"} />
      </InlineStack>
      {job.resumedBytes > 0 && <Text as="p" variant="bodySm" tone="success">Resumed — {formatFileSize(job.resumedBytes)} was already saved on the server.</Text>}
      <InlineStack align="space-between" blockAlign="center" gap="300">
        <Text as="span" variant="bodySm" tone="subdued">The server is downloading this, so you can refresh or close the page — it keeps going.</Text>
        <Button onClick={onPause}>Pause</Button>
      </InlineStack>
    </Card>
  );
}

/** A download that isn't running: stopped part-way, failed, or finished and saved. */
function RestingCard({ job, disabled, onUse, onResume, onDiscard }: { job: DriveJobSnapshot; disabled?: boolean; onUse: () => void; onResume: () => void; onDiscard: () => void }) {
  const done = job.status === "done";
  const failed = job.status === "error";
  const percent = percentOf(job);
  return (
    <Card>
      <FileHeading
        name={job.name}
        size={job.total}
        badge={<Badge tone={done ? "success" : failed ? "critical" : "attention"}>{done ? "Saved on the server" : failed ? "Failed" : `Paused · ${percent}%`}</Badge>}
      />
      {!done && job.total && <ProgressBar progress={percent} size="small" tone={failed ? "critical" : "primary"} />}
      {failed && job.error && <Banner tone="critical"><p>{job.error}</p></Banner>}
      <Text as="p" variant="bodySm" tone="subdued">
        {done
          ? "Already on the server — open it any time without downloading it again."
          : `${formatFileSize(job.received)}${job.total ? ` of ${formatFileSize(job.total)}` : ""} is saved on the server. Resuming fetches only the rest.`}
      </Text>
      <InlineStack gap="200">
        {done ? (
          <Button variant="primary" disabled={disabled} onClick={onUse}>Use this file</Button>
        ) : (
          <Button variant="primary" onClick={onResume}>{failed ? "Try again" : "Resume download"}</Button>
        )}
        <Button variant="plain" tone="critical" onClick={onDiscard}>{done ? "Delete from server" : "Discard"}</Button>
      </InlineStack>
    </Card>
  );
}

/**
 * "Or add it from Google Drive": paste a share link and the SERVER downloads the file from Drive (several pieces at once),
 * saves it on its own disk, and keeps going even if this page is closed. When it's finished the page opens the saved copy
 * straight from the server — the zip never has to be downloaded into the browser. The file must be shared as
 * "Anyone with the link".
 */
export function DriveLinkImport({ onSource, disabled }: { onSource: (source: RemoteZipSource) => void; disabled?: boolean }) {
  const [url, setUrl] = useState("");
  const [jobs, setJobs] = useState<DriveJobSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The download started from this page: it opens by itself the moment it finishes.
  const watchedId = useRef<string | null>(null);
  const anyActive = useRef(false);
  const onSourceRef = useRef(onSource);

  useEffect(() => {
    onSourceRef.current = onSource;
  }, [onSource]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      if (inFlight) return;
      inFlight = true;
      driveJobs
        .list()
        .then((list) => {
          if (cancelled) return;
          setJobs(list);
          anyActive.current = list.some(isActive);
          const finished = list.find((job) => job.id === watchedId.current && job.status === "done");
          if (finished) {
            watchedId.current = null;
            onSourceRef.current(remoteSourceOf(finished));
          }
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
          if (cancelled) return;
          const delay = document.visibilityState === "hidden" ? HIDDEN_POLL_MS : anyActive.current ? FAST_POLL_MS : SLOW_POLL_MS;
          timer = setTimeout(poll, delay);
        });
    };
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
  }, []);

  const act = async (work: () => Promise<DriveJobSnapshot | void>) => {
    setError(null);
    try {
      const job = await work();
      if (job) {
        setJobs((current) => [job, ...current.filter((existing) => existing.id !== job.id)]);
        anyActive.current = isActive(job) || anyActive.current;
        if (job.status === "done") {
          watchedId.current = null;
          onSourceRef.current(remoteSourceOf(job));
        }
      } else {
        setJobs(await driveJobs.list());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  const start = (link: string) =>
    act(async () => {
      const job = await driveJobs.start(link);
      watchedId.current = job.id;
      setUrl("");
      return job;
    });

  const submit = () => {
    const parsed = parseDriveLink(url);
    if (parsed.kind === "folder") return setError("That's a folder link. Zip the folder first, then share the zip file.");
    if (parsed.kind !== "file") return setError("That doesn't look like a Google Drive file link, e.g. https://drive.google.com/file/d/…/view");
    void start(url.trim());
  };

  return (
    <BlockStack gap="300">
      {jobs.map((job) =>
        isActive(job) ? (
          <RunningCard key={job.id} job={job} onPause={() => void act(() => driveJobs.pause(job.id))} />
        ) : (
          <RestingCard
            key={job.id}
            job={job}
            disabled={disabled}
            onUse={() => onSourceRef.current(remoteSourceOf(job))}
            onResume={() => void start(job.url)}
            onDiscard={() => void act(() => driveJobs.discard(job.id))}
          />
        ),
      )}

      <Text as="p" variant="bodySm" tone="subdued">
        Or add it from Google Drive — paste the file&apos;s share link (it must be shared as &ldquo;Anyone with the link&rdquo;). The server downloads and saves it.
      </Text>
      <InlineStack gap="200" blockAlign="end" wrap={false}>
        <div style={{ flex: 1 }}>
          <TextField
            label="Google Drive link"
            labelHidden
            placeholder="https://drive.google.com/file/d/…/view?usp=sharing"
            value={url}
            onChange={setUrl}
            autoComplete="off"
            disabled={disabled}
            clearButton
            onClearButtonClick={() => setUrl("")}
          />
        </div>
        <Button variant="primary" disabled={disabled || url.trim() === ""} onClick={submit}>Download on server</Button>
      </InlineStack>
      {error && <Banner tone="warning" onDismiss={() => setError(null)}><p>{error}</p></Banner>}
    </BlockStack>
  );
}
