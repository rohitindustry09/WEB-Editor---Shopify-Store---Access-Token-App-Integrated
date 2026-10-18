"use client";

import { BlockStack, InlineStack, Text, Banner, Button, ProgressBar } from "@shopify/polaris";
import { STAGE_LABEL, triggerUrlDownload, type PipelineRunState } from "./pipelineRunStore";

type Props = {
  state: PipelineRunState;
  running: boolean;
  onCancel: () => void;
  onDismiss: () => void;
};

function formatEta(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `~${totalSeconds}s`;
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `~${hours}h ${remMinutes}m`;
}

/**
 * A live ETA derived from the real rate observed so far this run — not a
 * pre-run guess, since there's no way to know a store's true product count
 * before actually scraping it. Only shown once discovery has settled
 * (`totalDiscovered` stops changing once status leaves "discovering") and
 * at least a few products have gone by, so the estimate isn't just noise
 * from the first handful of requests.
 */
function scrapeEtaLabel(state: PipelineRunState): string | null {
  const { scrapeJob, scrapeStartedAt } = state;
  if (!scrapeJob || !scrapeStartedAt || scrapeJob.status !== "scraping") return null;
  if (scrapeJob.scrapedCount < 5 || scrapeJob.totalDiscovered <= scrapeJob.scrapedCount) return null;

  const elapsedMs = Date.now() - scrapeStartedAt;
  const ratePerMs = scrapeJob.scrapedCount / elapsedMs;
  if (!Number.isFinite(ratePerMs) || ratePerMs <= 0) return null;
  const remaining = scrapeJob.totalDiscovered - scrapeJob.scrapedCount;
  return `${formatEta(remaining / ratePerMs)} remaining`;
}

/**
 * The actual progress content — percentage, stage label, image counts,
 * done/error/cancelled banners. Shared verbatim between the full popup
 * (`PipelineGlobalWidget`'s Modal) and, if a page wants it, an inline
 * embed — one implementation instead of the popup and the page drifting
 * apart from each other over time.
 */
export function PipelineProgressPanel({ state, running, onCancel, onDismiss }: Props) {
  const { stage, error, scrapeJob, stageProgress, skippedCount, finalSite, finalCount } = state;

  const scrapeStatusLabel =
    scrapeJob && (scrapeJob.status === "discovering" || scrapeJob.status === "scraping")
      ? `${scrapeJob.productCount.toLocaleString()} product${scrapeJob.productCount === 1 ? "" : "s"} scraped so far…`
      : null;
  const scrapeEta = scrapeEtaLabel(state);

  return (
    <BlockStack gap="300">
      {error && (
        <Banner tone="critical" onDismiss={onDismiss}>
          <p>{error}</p>
        </Banner>
      )}

      {stage === "cancelled" && (
        <Banner tone="info" onDismiss={onDismiss}>
          <p>
            Cancelled — nothing further was processed.
            {finalSite ? ` Anything already saved before cancelling is still on disk under "${finalSite}".` : ""}
          </p>
        </Banner>
      )}

      {running && (
        <BlockStack gap="150">
          <InlineStack align="space-between" blockAlign="center" gap="200">
            <BlockStack gap="050">
              <Text as="span" fontWeight="medium">{STAGE_LABEL[stage]}</Text>
              {scrapeStatusLabel && (
                <Text as="span" tone="subdued" variant="bodySm">
                  {scrapeStatusLabel}
                  {scrapeEta ? ` ${scrapeEta}` : ""}
                </Text>
              )}
            </BlockStack>
            <Button tone="critical" onClick={onCancel}>Cancel</Button>
          </InlineStack>
          {stageProgress && stageProgress.total > 0 && (
            <>
              <ProgressBar progress={Math.round((stageProgress.done / stageProgress.total) * 100)} size="small" tone="primary" />
              <Text as="span" tone="subdued" variant="bodySm">
                {`${stageProgress.done.toLocaleString()} of ${stageProgress.total.toLocaleString()} (${Math.round((stageProgress.done / stageProgress.total) * 100)}%)`}
              </Text>
            </>
          )}
        </BlockStack>
      )}

      {stage === "done" && finalSite && (
        <Banner tone="success">
          <BlockStack gap="200">
            <p>
              {`Done — ${finalCount.toLocaleString()} image${finalCount === 1 ? "" : "s"} in your final zip.`}
              {skippedCount > 0
                ? ` ${skippedCount.toLocaleString()} image${skippedCount === 1 ? "" : "s"} had a processing error and were kept unmodified rather than dropped.`
                : ""}
              {" "}The download should have started automatically.
            </p>
            <InlineStack>
              <Button onClick={() => triggerUrlDownload(`/api/bg-customiser/export-zip?site=${encodeURIComponent(finalSite)}`)}>
                Download again
              </Button>
            </InlineStack>
          </BlockStack>
        </Banner>
      )}
    </BlockStack>
  );
}
