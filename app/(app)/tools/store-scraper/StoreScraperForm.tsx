"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  Banner,
  Icon,
  RadioButton,
  TextField,
  Checkbox,
  Spinner,
  Pagination,
  ProgressBar,
  Collapsible,
} from "@shopify/polaris";
import {
  StoreIcon,
  GlobeIcon,
  CodeIcon,
  LinkIcon,
  SettingsIcon,
  TextIcon,
  ArrowRightIcon,
  ImageIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ClockIcon,
  RefreshIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "@shopify/polaris-icons";
import type { ScrapeFailure, ScrapeJobSummary, ScrapedProduct, ScraperPlatform, ScrapeScope } from "@/lib/storeScraper/types";
import { mapWithConcurrency } from "@/lib/concurrency";
import { ExcludeZipExport } from "./ExcludeZipExport";

const POLL_INTERVAL_MS = 1500;
const PAGE_SIZE = 50;
/** Remembers the last job this browser started, so refreshing the page (or coming back later) reconnects to it instead of losing track — the scrape itself keeps running server-side regardless of the tab, but without this the UI had no way back to it. */
const ACTIVE_JOB_STORAGE_KEY = "storeScraper.activeJobId";

const PLATFORM_INFO: Record<ScraperPlatform, { label: string; icon: typeof StoreIcon; description: string; recommended?: boolean }> = {
  shopify: {
    label: "Shopify",
    icon: StoreIcon,
    description: "Uses the store's public /products.json storefront API for structured data, plus the live page for custom spec fields and videos.",
    recommended: true,
  },
  wordpress: {
    label: "WordPress",
    icon: GlobeIcon,
    description: "Tries the WooCommerce REST API first for a full-store list, and falls back to crawling the category/shop archive page.",
  },
  magento: {
    label: "Magento",
    icon: CodeIcon,
    description: "Uses the store's public /graphql storefront API — the same one its own frontend uses — for structured data in bulk.",
  },
};

function formatMoney(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  return currency ? `${currency} ${value.toFixed(2)}` : value.toFixed(2);
}

function StatusBadge({ status }: { status: ScrapeJobSummary["status"] }) {
  if (status === "done") return <Badge tone="success">Completed</Badge>;
  if (status === "error") return <Badge tone="critical">Failed</Badge>;
  if (status === "cancelled") return <Badge>Cancelled</Badge>;
  return <Badge tone="info">{status === "discovering" ? "Discovering" : status === "scraping" ? "Scraping" : "Queued"}</Badge>;
}

export function StoreScraperForm() {
  const [platform, setPlatform] = useState<ScraperPlatform>("shopify");
  const [scope, setScope] = useState<ScrapeScope>("store");
  const [storeUrl, setStoreUrl] = useState("");
  const [requestedFieldsText, setRequestedFieldsText] = useState("");
  const [containerClassesText, setContainerClassesText] = useState("");
  const [useCache, setUseCache] = useState(true);
  const [allowInsecureTls, setAllowInsecureTls] = useState(false);
  const [quickMediaMode, setQuickMediaMode] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; robotsWarning?: string | null } | null>(null);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [job, setJob] = useState<ScrapeJobSummary | null>(null);
  const [products, setProducts] = useState<ScrapedProduct[]>([]);
  const [failures, setFailures] = useState<ScrapeFailure[]>([]);
  const [failuresOpen, setFailuresOpen] = useState(false);
  // Defaults to collapsed and NOT rendered at all (not just CSS-hidden) —
  // a real store's product grid can be thousands of images, and loading
  // every one of those on page load just to have them sit behind a
  // "Collapse" toggle is wasted bandwidth/DOM nobody asked for yet.
  const [showProducts, setShowProducts] = useState(false);
  const [page, setPage] = useState(1);
  const [recentJobs, setRecentJobs] = useState<ScrapeJobSummary[]>([]);

  // ---- Bulk import: queue several URLs at once, reusing whatever platform/scope/options are set above for every one of them. ----
  const [bulkUrlsText, setBulkUrlsText] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResults, setBulkResults] = useState<{ url: string; ok: boolean; error?: string }[] | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  // ---- Catalog comparison: which scraped SKUs already exist in the connected Shopify store ----
  const [catalogComparing, setCatalogComparing] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogResult, setCatalogResult] = useState<{ existingSkus: Set<string>; noSkuCount: number; checkedCount: number } | null>(null);

  const [mediaSaving, setMediaSaving] = useState(false);
  const [mediaSaveError, setMediaSaveError] = useState<string | null>(null);
  const [lastMediaSave, setLastMediaSave] = useState<{
    hostname: string;
    folderPath: string;
    savedCount: number;
    skippedCount: number;
    failedCount: number;
  } | null>(null);
  const [mediaSaveProgress, setMediaSaveProgress] = useState<{ done: number; total: number } | null>(null);
  // The job id to retry against if a save errors out (e.g. the page was
  // refreshed mid-save and the connection dropped) — re-runs the same save
  // rather than making the user re-trigger it manually.
  const [lastSaveAttemptJobId, setLastSaveAttemptJobId] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const saveMedia = useCallback(async (jobId: string) => {
    setLastSaveAttemptJobId(jobId);
    setMediaSaving(true);
    setMediaSaveError(null);
    setMediaSaveProgress({ done: 0, total: 0 });
    const progressInterval = setInterval(() => {
      void fetch(`/api/store-scraper/jobs/${jobId}/export-media-progress`)
        .then((r) => r.json())
        .then((p: { done: number; total: number }) => setMediaSaveProgress(p))
        .catch(() => {
          // Progress is a nice-to-have readout — a failed poll just means the next tick tries again.
        });
    }, 600);
    try {
      const res = await fetch(`/api/store-scraper/jobs/${jobId}/save-media`, { method: "POST" });
      const data = (await res.json()) as
        | { hostname: string; folderPath: string; savedCount: number; skippedCount: number; failedCount: number }
        | { error: string };
      if (!res.ok || "error" in data) throw new Error("error" in data ? data.error : "Couldn't save media.");
      setLastMediaSave(data);
    } catch (err) {
      setMediaSaveError(err instanceof Error ? err.message : "Couldn't save media.");
    } finally {
      clearInterval(progressInterval);
      setMediaSaving(false);
      setMediaSaveProgress(null);
    }
  }, []);

  const loadRecentJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/store-scraper");
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: ScrapeJobSummary[] };
      setRecentJobs(data.jobs);
    } catch {
      // Recent jobs is a convenience list — a failed refresh isn't worth surfacing an error for.
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void loadRecentJobs(), 0);
    return () => clearTimeout(timer);
  }, [loadRecentJobs]);

  const fetchJobPage = useCallback(async (jobId: string, pageNum: number): Promise<boolean> => {
    const res = await fetch(`/api/store-scraper/jobs/${jobId}?page=${pageNum}&pageSize=${PAGE_SIZE}`);
    if (!res.ok) return false;
    const data = (await res.json()) as { job: ScrapeJobSummary; products: ScrapedProduct[]; failures: ScrapeFailure[] };
    setJob(data.job);
    setProducts(data.products);
    setFailures(data.failures);
    return true;
  }, []);

  // Reconnects to whatever job this browser last started, once, on mount —
  // the scrape runs server-side regardless of this tab, so a refresh (or
  // coming back later) shouldn't strand the UI on a blank form while a job
  // is still (or was) running. Clears the remembered id if that job is
  // gone (e.g. this points at a job from a wiped dev environment).
  useEffect(() => {
    const storedJobId = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_JOB_STORAGE_KEY) : null;
    if (!storedJobId) return;
    const timer = setTimeout(() => {
      void fetchJobPage(storedJobId, 1).then((ok) => {
        if (!ok) localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
      });
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only reconnect, intentionally not re-running on fetchJobPage identity changes
  }, []);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error" || job.status === "cancelled") {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(() => {
      void fetchJobPage(job.id, page);
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-arms only on job id/status change, not every product-count tick
  }, [job?.id, job?.status, page, fetchJobPage]);

  useEffect(() => {
    if (!job || (job.status !== "done" && job.status !== "error")) return;
    const timer = setTimeout(() => void loadRecentJobs(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  // The moment the job finishes, save every image straight to local disk
  // (`uploads/<site>/<SKU>/<original-filename>`) — no exclusions, no
  // renaming, no browser download step. Guarded by a flag in
  // `localStorage`, not a `useRef`: a ref resets to nothing on every page
  // reload, so a refresh right as this fired was re-triggering the SAME
  // auto-save from scratch on reconnect. Persisting "already triggered for
  // this job" is what actually stops that — and since this now just fills
  // in local files (each one skipped if already on disk), even a save
  // that keeps running after a refresh isn't wasted the way an abandoned
  // browser download used to be.
  useEffect(() => {
    if (!job || job.status !== "done" || job.productCount === 0) return;
    const storageKey = `storeScraper.mediaSaved.${job.id}`;
    let alreadyTriggered = false;
    try {
      alreadyTriggered = localStorage.getItem(storageKey) === "1";
    } catch {
      // Storage unavailable — fall through and save anyway rather than silently skipping.
    }
    if (alreadyTriggered) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, "1");
      } catch {
        // Private browsing / storage disabled — this still saves once, just isn't guaranteed to stay suppressed after a future refresh.
      }
      void saveMedia(job.id);
    }, 0);
    return () => clearTimeout(timer);
  }, [job, saveMedia]);

  const handleTestUrl = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/store-scraper/test-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: storeUrl, allowInsecureTls }),
      });
      const data = (await res.json()) as { ok: boolean; message: string; robotsWarning?: string | null };
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, message: "Couldn't reach the test endpoint." });
    } finally {
      setTesting(false);
    }
  };

  const handleStart = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/store-scraper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          scope,
          inputUrl: storeUrl,
          requestedFields: requestedFieldsText,
          containerClasses: containerClassesText,
          useCache,
          allowInsecureTls,
          quickMediaMode,
        }),
      });
      const data = (await res.json()) as { job?: ScrapeJobSummary; error?: string };
      if (!res.ok || !data.job) {
        setStartError(data.error ?? "Couldn't start the job.");
        return;
      }
      setJob(data.job);
      setPage(1);
      try {
        localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, data.job.id);
      } catch {
        // Private browsing / storage disabled — reconnect-after-refresh just won't work this session, not fatal.
      }
      await fetchJobPage(data.job.id, 1);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Couldn't start the job.");
    } finally {
      setStarting(false);
    }
  };

  /** Opens an already-started job (from the Recent jobs list) as the current one — same reconnect path a page refresh already uses via `ACTIVE_JOB_STORAGE_KEY`. */
  const openJob = (jobId: string) => {
    setPage(1);
    void fetchJobPage(jobId, 1);
    try {
      localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, jobId);
    } catch {
      // Private browsing / storage disabled — this tab still shows the job, just won't reconnect to it after a refresh.
    }
  };

  /**
   * Queues one job per pasted URL, reusing the platform/scope/options
   * already set above for all of them — each job runs independently
   * server-side (same as a single manual "Start scraping" click) the
   * moment its own POST returns, so this doesn't wait for one to finish
   * before starting the next. `mapWithConcurrency` here only bounds how
   * fast the START requests themselves go out, not the scrapes — those are
   * already independent background jobs regardless.
   */
  const handleBulkImport = async () => {
    const urls = Array.from(new Set(bulkUrlsText.split(/\r?\n/).map((u) => u.trim()).filter(Boolean)));
    if (urls.length === 0) return;
    setBulkSubmitting(true);
    setBulkResults([]);
    await mapWithConcurrency(urls, 3, async (url) => {
      try {
        const res = await fetch("/api/store-scraper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform,
            scope,
            inputUrl: url,
            requestedFields: requestedFieldsText,
            containerClasses: containerClassesText,
            useCache,
            allowInsecureTls,
            quickMediaMode,
          }),
        });
        const data = (await res.json()) as { job?: ScrapeJobSummary; error?: string };
        if (!res.ok || !data.job) throw new Error(data.error ?? "Couldn't start.");
        setBulkResults((prev) => [...(prev ?? []), { url, ok: true }]);
      } catch (err) {
        setBulkResults((prev) => [...(prev ?? []), { url, ok: false, error: err instanceof Error ? err.message : "Couldn't start." }]);
      }
    });
    setBulkSubmitting(false);
    void loadRecentJobs();
  };

  // Stale comparison results from a previously-viewed job would otherwise
  // linger and badge the wrong products the moment a different job's
  // product grid renders.
  useEffect(() => {
    setCatalogResult(null);
    setCatalogError(null);
  }, [job?.id]);

  const handleCompareCatalog = async () => {
    if (!job) return;
    setCatalogComparing(true);
    setCatalogError(null);
    try {
      const res = await fetch(`/api/store-scraper/jobs/${job.id}/compare-catalog`, { method: "POST" });
      const data = (await res.json()) as { existingSkus?: string[]; noSkuCount?: number; checkedCount?: number; error?: string };
      if (!res.ok || !data.existingSkus) throw new Error(data.error ?? "Couldn't compare against your catalog.");
      setCatalogResult({
        existingSkus: new Set(data.existingSkus.map((s) => s.toLowerCase())),
        noSkuCount: data.noSkuCount ?? 0,
        checkedCount: data.checkedCount ?? 0,
      });
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : "Couldn't compare against your catalog.");
    } finally {
      setCatalogComparing(false);
    }
  };

  const handleCancel = async () => {
    if (!job) return;
    setCancelling(true);
    try {
      await fetch(`/api/store-scraper/jobs/${job.id}/cancel`, { method: "POST" });
      await fetchJobPage(job.id, page);
    } finally {
      setCancelling(false);
    }
  };

  const isRunning = job !== null && (job.status === "queued" || job.status === "discovering" || job.status === "scraping");
  const totalPages = job ? Math.max(1, Math.ceil(job.productCount / PAGE_SIZE)) : 1;
  const scrapeProgressPercent =
    job && job.status === "done"
      ? 100
      : job && job.totalDiscovered > 0
        ? Math.round(((job.scrapedCount + job.failedCount) / job.totalDiscovered) * 100)
        : 0;

  const changePage = async (nextPage: number) => {
    setPage(nextPage);
    if (job) await fetchJobPage(job.id, nextPage);
  };

  return (
    <Page
      fullWidth
      title="Store Scraper"
      subtitle="Pull every product — name, price, images, SKU, and custom spec fields — from a Shopify or WordPress store."
      backAction={{ content: "Store connection", url: "/settings/connection" }}
      titleMetadata={<Badge tone="magic">On-device fetch, server-side</Badge>}
    >
      <Layout>
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
            {(Object.keys(PLATFORM_INFO) as ScraperPlatform[]).map((key) => {
              const info = PLATFORM_INFO[key];
              const active = platform === key;
              return (
                <Card key={key} padding="400">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start">
                      <Box background={active ? "bg-fill-brand" : "bg-surface-secondary"} padding="200" borderRadius="200">
                        <span style={{ color: active ? "#fff" : undefined, display: "flex" }}>
                          <Icon source={info.icon} tone={active ? "inherit" : "subdued"} />
                        </span>
                      </Box>
                      {info.recommended && <Badge tone="success">Recommended</Badge>}
                    </InlineStack>
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingSm">{info.label}</Text>
                      <Text as="p" tone="subdued" variant="bodySm">{info.description}</Text>
                    </BlockStack>
                    <BlockStack gap="150">
                      <RadioButton
                        label="Specific collection URL"
                        checked={active && scope === "collection"}
                        onChange={() => {
                          setPlatform(key);
                          setScope("collection");
                        }}
                      />
                      <RadioButton
                        label="Entire store"
                        checked={active && scope === "store"}
                        onChange={() => {
                          setPlatform(key);
                          setScope("store");
                        }}
                      />
                    </BlockStack>
                  </BlockStack>
                </Card>
              );
            })}
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <Box background="bg-fill-info" padding="150" borderRadius="150">
                  <span style={{ color: "#fff", display: "flex" }}>
                    <Icon source={LinkIcon} tone="inherit" />
                  </span>
                </Box>
                <BlockStack gap="050">
                  <Text as="h2" variant="headingSm">Store details</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Enter the store URL and configure what data to capture.
                  </Text>
                </BlockStack>
              </InlineStack>

              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                <TextField
                  label={scope === "collection" ? "Collection / category URL" : "Store URL (home page or domain)"}
                  autoComplete="off"
                  value={storeUrl}
                  onChange={setStoreUrl}
                  placeholder="https://example.com"
                />
                <BlockStack gap="150">
                  <Text as="span" variant="bodySm" fontWeight="medium">Test connection</Text>
                  <InlineStack align="space-between" blockAlign="center" gap="300">
                    <InlineStack gap="150" blockAlign="center">
                      {testing ? (
                        <Spinner size="small" />
                      ) : testResult ? (
                        <Icon source={testResult.ok ? CheckCircleIcon : AlertCircleIcon} tone={testResult.ok ? "success" : "critical"} />
                      ) : null}
                      <Text as="span" tone="subdued" variant="bodySm">
                        {testResult ? testResult.message : "Not tested yet"}
                      </Text>
                    </InlineStack>
                    <Button onClick={handleTestUrl} loading={testing} disabled={!storeUrl.trim()}>
                      Test URL
                    </Button>
                  </InlineStack>
                  {testResult?.robotsWarning && (
                    <Banner tone="warning">
                      <p>{testResult.robotsWarning}</p>
                    </Banner>
                  )}
                </BlockStack>
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="150" blockAlign="center">
                  <Icon source={LinkIcon} tone="subdued" />
                  <Text as="h2" variant="headingSm">Bulk import</Text>
                </InlineStack>
                <Button variant="plain" onClick={() => setBulkImportOpen((v) => !v)}>
                  {bulkImportOpen ? "Hide" : "Queue several stores at once"}
                </Button>
              </InlineStack>
              <Collapsible id="bulk-import" open={bulkImportOpen}>
                <BlockStack gap="300">
                  <Text as="p" tone="subdued" variant="bodySm">
                    One URL per line — each gets queued as its own job using the platform, scope, and options set
                    below. They run independently; check Recent jobs below for progress on each.
                  </Text>
                  <TextField
                    label="URLs"
                    labelHidden
                    multiline={4}
                    autoComplete="off"
                    value={bulkUrlsText}
                    onChange={setBulkUrlsText}
                    placeholder={"https://store-a.com\nhttps://store-b.com\nhttps://store-c.com/collections/sale"}
                  />
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" tone="subdued" variant="bodySm">
                      {bulkUrlsText.trim()
                        ? `${new Set(bulkUrlsText.split(/\r?\n/).map((u) => u.trim()).filter(Boolean)).size} URL(s)`
                        : ""}
                    </Text>
                    <Button onClick={() => void handleBulkImport()} loading={bulkSubmitting} disabled={!bulkUrlsText.trim()}>
                      Queue all
                    </Button>
                  </InlineStack>
                  {bulkResults && bulkResults.length > 0 && (
                    <BlockStack gap="100">
                      {bulkResults.map((r) => (
                        <InlineStack key={r.url} gap="150" blockAlign="center">
                          <Icon source={r.ok ? CheckCircleIcon : AlertCircleIcon} tone={r.ok ? "success" : "critical"} />
                          <Text as="span" variant="bodySm" truncate>{r.url}</Text>
                          {!r.ok && r.error && <Text as="span" tone="critical" variant="bodySm">{r.error}</Text>}
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Collapsible>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={TextIcon} tone="subdued" />
                  <BlockStack gap="050">
                    <Text as="h2" variant="headingSm">Data fields to capture</Text>
                    <Text as="p" tone="subdued" variant="bodySm">One per line — leave blank to capture everything found.</Text>
                  </BlockStack>
                </InlineStack>
                <TextField
                  label="Data fields"
                  labelHidden
                  multiline={4}
                  autoComplete="off"
                  value={requestedFieldsText}
                  onChange={setRequestedFieldsText}
                  placeholder={"Dimension\nPackage Contents\nMaterial\nWeight"}
                />
                <TextField
                  label="Custom field container classes (optional)"
                  autoComplete="off"
                  value={containerClassesText}
                  onChange={setContainerClassesText}
                  placeholder="internal-features-list"
                  helpText="Class name(s) of the block to read every <li> from, e.g. when fields are missing."
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={SettingsIcon} tone="subdued" />
                  <Text as="h2" variant="headingSm">Options</Text>
                </InlineStack>
                <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                  <Checkbox
                    label="Use cached results if available"
                    checked={useCache}
                    onChange={setUseCache}
                    helpText="Skip re-scraping if this exact URL was already scraped successfully."
                  />
                </Box>
                <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                  <Checkbox
                    label="Ignore invalid SSL certificate"
                    checked={allowInsecureTls}
                    onChange={setAllowInsecureTls}
                    helpText="Only for stores you're already sure are legitimate but have a broken/mismatched cert (e.g. shared hosting)."
                  />
                </Box>
                <Box background="bg-surface-magic" padding="300" borderRadius="200">
                  <Checkbox
                    label="Quick media mode — images only, skip custom fields"
                    checked={quickMediaMode}
                    onChange={setQuickMediaMode}
                    helpText={
                      platform === "shopify"
                        ? "Custom fields/videos only ever come from the rendered product page — skipping that fetch makes every product's images available almost as fast as discovery itself finishes, with no per-product requests at all. Data fields to capture above won't be captured."
                        : platform === "magento"
                          ? "Magento already gets everything (including images) from the same discovery query — this has no extra effect for Magento."
                          : "WordPress still needs its one page fetch per product either way — this won't speed up a WordPress scrape, only Shopify's."
                    }
                  />
                </Box>
                <Button variant="primary" size="large" fullWidth onClick={handleStart} loading={starting || isRunning} disabled={!storeUrl.trim()}>
                  {isRunning ? (job?.statusMessage ?? "Scraping…") : "Start scraping"}
                </Button>
                {startError && (
                  <Banner tone="critical" onDismiss={() => setStartError(null)}>
                    <p>{startError}</p>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        {job && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" wrap gap="300">
                  <InlineStack gap="300" blockAlign="center">
                    <Box background={PLATFORM_INFO[job.options.platform].recommended ? "bg-fill-success" : "bg-fill-info"} padding="150" borderRadius="150">
                      <span style={{ color: "#fff", display: "flex" }}>
                        <Icon source={PLATFORM_INFO[job.options.platform].icon} tone="inherit" />
                      </span>
                    </Box>
                    <BlockStack gap="050">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h2" variant="headingSm">
                          Products from {new URL(job.options.inputUrl).hostname}
                        </Text>
                        <Badge>{`${job.productCount} products`}</Badge>
                        <StatusBadge status={job.status} />
                      </InlineStack>
                    </BlockStack>
                  </InlineStack>
                  <InlineStack gap="200">
                    <Button url={`/api/store-scraper/jobs/${job.id}/export-csv`} disabled={job.productCount === 0}>
                      Export CSV
                    </Button>
                    <Button url={`/api/store-scraper/jobs/${job.id}/export-shopify-csv`} disabled={job.productCount === 0}>
                      Export as Shopify Import
                    </Button>
                    <Button loading={mediaSaving} disabled={job.productCount === 0} onClick={() => void saveMedia(job.id)}>
                      {lastMediaSave ? "Save media again" : "Save Media to Server"}
                    </Button>
                  </InlineStack>
                </InlineStack>

                <BlockStack gap="150">
                  <InlineGrid columns={{ xs: 2, sm: job.failedCount > 0 ? 4 : 3 }} gap="300">
                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="150">
                        <Icon source={ClockIcon} tone="subdued" />
                        <Text as="p" variant="headingLg">{job.totalDiscovered}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Found</Text>
                      </BlockStack>
                    </Box>
                    <Box background="bg-surface-magic" padding="300" borderRadius="200">
                      <BlockStack gap="150">
                        <Icon source={RefreshIcon} tone="magic" />
                        <Text as="p" variant="headingLg">{scrapeProgressPercent}%</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Progress</Text>
                      </BlockStack>
                    </Box>
                    <Box background="bg-fill-success-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="150">
                        <Icon source={CheckCircleIcon} tone="success" />
                        <Text as="p" variant="headingLg">{job.scrapedCount}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Scraped</Text>
                      </BlockStack>
                    </Box>
                    {job.failedCount > 0 && (
                      <Box background="bg-fill-critical-secondary" padding="300" borderRadius="200">
                        <BlockStack gap="150">
                          <Icon source={AlertCircleIcon} tone="critical" />
                          <Text as="p" variant="headingLg">{job.failedCount}</Text>
                          <Text as="p" variant="bodySm" tone="subdued">Failed</Text>
                        </BlockStack>
                      </Box>
                    )}
                  </InlineGrid>
                  <ProgressBar progress={scrapeProgressPercent} tone={job.status === "error" ? "critical" : "primary"} size="small" />
                  <InlineStack align="space-between" blockAlign="center" gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">{job.statusMessage}</Text>
                    {isRunning && (
                      <Button tone="critical" size="micro" loading={cancelling} onClick={() => void handleCancel()}>
                        Cancel
                      </Button>
                    )}
                  </InlineStack>
                </BlockStack>

                <ExcludeZipExport job={job} />

                {mediaSaving && (
                  <Banner tone="info" title="Saving product media to your disk…">
                    <BlockStack gap="150">
                      <InlineStack gap="150" blockAlign="center">
                        <Spinner size="small" />
                        <p>
                          {mediaSaveProgress && mediaSaveProgress.total > 0
                            ? `Saved ${mediaSaveProgress.done} of ${mediaSaveProgress.total} product folders to uploads/ — this isn't stuck.`
                            : "Starting up — this can take a few minutes for a large store. Files already on disk from a previous save are skipped, not re-downloaded."}
                        </p>
                      </InlineStack>
                      {mediaSaveProgress && mediaSaveProgress.total > 0 && (
                        <ProgressBar progress={Math.round((mediaSaveProgress.done / mediaSaveProgress.total) * 100)} tone="primary" size="small" />
                      )}
                    </BlockStack>
                  </Banner>
                )}

                {!mediaSaving && lastMediaSave && (
                  <Banner tone="success" title="Media saved">
                    <p>
                      {`uploads/${lastMediaSave.hostname} — ${lastMediaSave.savedCount} saved, ${lastMediaSave.skippedCount} already there`}
                      {lastMediaSave.failedCount > 0 ? `, ${lastMediaSave.failedCount} failed` : ""}.
                    </p>
                  </Banner>
                )}

                {mediaSaveError && (
                  <Banner tone="critical" onDismiss={() => setMediaSaveError(null)}>
                    <BlockStack gap="200">
                      <p>{mediaSaveError}</p>
                      {lastSaveAttemptJobId && (
                        <InlineStack>
                          <Button onClick={() => void saveMedia(lastSaveAttemptJobId)}>Retry save</Button>
                        </InlineStack>
                      )}
                    </BlockStack>
                  </Banner>
                )}

                {job.error && (
                  <Banner tone={job.status === "error" ? "critical" : "warning"} title={job.status === "error" ? undefined : "Finished with a note"}>
                    <p>{job.error}</p>
                  </Banner>
                )}

                {failures.length > 0 && (
                  <BlockStack gap="150">
                    <button
                      type="button"
                      onClick={() => setFailuresOpen((v) => !v)}
                      style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    >
                      <Icon source={failuresOpen ? ChevronDownIcon : ChevronRightIcon} tone="subdued" />
                      <Text as="span" fontWeight="medium" tone="critical">
                        {`${failures.length} failed item${failures.length === 1 ? "" : "s"} — why they failed`}
                      </Text>
                    </button>
                    <Collapsible id="scrape-failures" open={failuresOpen}>
                      <Box background="bg-surface-secondary" borderRadius="200" padding="0">
                        <BlockStack gap="0">
                          {failures.slice(0, 200).map((failure, index) => (
                            <Box
                              key={`${failure.input}-${index}`}
                              padding="200"
                              borderBlockStartWidth={index === 0 ? "0" : "025"}
                              borderColor="border-secondary"
                            >
                              <BlockStack gap="050">
                                <Text as="span" variant="bodySm" fontWeight="medium" truncate>
                                  {failure.input}
                                </Text>
                                <Text as="span" variant="bodySm" tone="critical">
                                  {failure.error}
                                </Text>
                              </BlockStack>
                            </Box>
                          ))}
                          {failures.length > 200 && (
                            <Box padding="200">
                              <Text as="span" variant="bodySm" tone="subdued">
                                {`+ ${failures.length - 200} more — showing the first 200.`}
                              </Text>
                            </Box>
                          )}
                        </BlockStack>
                      </Box>
                    </Collapsible>
                  </BlockStack>
                )}

                {products.length === 0 ? (
                  <Box padding="800">
                    <BlockStack gap="200" inlineAlign="center">
                      {isRunning ? <Spinner size="small" /> : <Icon source={ImageIcon} tone="subdued" />}
                      <Text as="p" variant="headingSm">{isRunning ? "Scraping in progress…" : "No products yet"}</Text>
                      <Text as="p" tone="subdued">
                        {isRunning ? "Products will appear here as they're found." : "Nothing was scraped for this job."}
                      </Text>
                    </BlockStack>
                  </Box>
                ) : (
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center" gap="200">
                      <button
                        type="button"
                        onClick={() => setShowProducts((v) => !v)}
                        style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                      >
                        <Icon source={showProducts ? ChevronDownIcon : ChevronRightIcon} tone="subdued" />
                        <Text as="span" fontWeight="medium">
                          {`${showProducts ? "Hide" : "Show"} product grid (${products.length.toLocaleString()} product${products.length === 1 ? "" : "s"})`}
                        </Text>
                      </button>
                      <Button size="micro" onClick={() => void handleCompareCatalog()} loading={catalogComparing}>
                        Compare to my Shopify catalog
                      </Button>
                    </InlineStack>
                    {catalogError && (
                      <Banner tone="warning" onDismiss={() => setCatalogError(null)}>
                        <p>{catalogError}</p>
                      </Banner>
                    )}
                    {catalogResult && (
                      <Banner tone="info" onDismiss={() => setCatalogResult(null)}>
                        <p>
                          {`${catalogResult.existingSkus.size.toLocaleString()} of ${catalogResult.checkedCount.toLocaleString()} checked SKUs already exist in your connected store — the rest (${(catalogResult.checkedCount - catalogResult.existingSkus.size).toLocaleString()}) look new.`}
                          {catalogResult.noSkuCount > 0
                            ? ` ${catalogResult.noSkuCount.toLocaleString()} scraped product${catalogResult.noSkuCount === 1 ? "" : "s"} had no SKU to check.`
                            : ""}
                        </p>
                      </Banner>
                    )}
                    {showProducts && (
                      <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 5 }} gap="300">
                        {products.map((product) => (
                      <Card key={product.productId} padding="0">
                        <div style={{ position: "relative", aspectRatio: "1", background: "var(--p-color-bg-surface-secondary)", overflow: "hidden" }}>
                          {product.images[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element -- external, arbitrary third-party image URL
                            <img src={product.images[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <BlockStack gap="0" inlineAlign="center">
                              <Box padding="800">
                                <Icon source={ImageIcon} tone="subdued" />
                              </Box>
                            </BlockStack>
                          )}
                          {product.images.length > 0 && (
                            <div style={{ position: "absolute", top: 8, right: 8 }}>
                              <Badge>{`${product.images.length} img`}</Badge>
                            </div>
                          )}
                        </div>
                        <Box padding="300">
                          <BlockStack gap="150">
                            <Text as="h3" variant="bodySm" fontWeight="semibold" truncate>
                              {product.name}
                            </Text>
                            <InlineStack gap="150" blockAlign="center">
                              <Text as="span" fontWeight="semibold">{formatMoney(product.price, product.currency)}</Text>
                              {product.compareAtPrice !== null && (
                                <Text as="span" tone="subdued">
                                  <s>{formatMoney(product.compareAtPrice, product.currency)}</s>
                                </Text>
                              )}
                            </InlineStack>
                            {product.sku && (
                              <InlineStack gap="100" blockAlign="center">
                                <Text as="span" tone="subdued" variant="bodySm">SKU {product.sku}</Text>
                                {catalogResult?.existingSkus.has(product.sku.toLowerCase()) && (
                                  <Badge tone="attention" size="small">Already in store</Badge>
                                )}
                              </InlineStack>
                            )}
                            {product.customFields.slice(0, 2).map((field) => (
                              <Box key={field.label} background="bg-surface-secondary" padding="150" borderRadius="150">
                                <Text as="span" variant="bodySm" truncate>
                                  {field.label}: {field.value}
                                </Text>
                              </Box>
                            ))}
                            <InlineStack align="end">
                              <Button
                                size="micro"
                                icon={ArrowRightIcon}
                                accessibilityLabel="View details"
                                url={product.url}
                                external
                              />
                            </InlineStack>
                          </BlockStack>
                        </Box>
                      </Card>
                        ))}
                      </InlineGrid>
                    )}
                  </BlockStack>
                )}

                {showProducts && job.productCount > PAGE_SIZE && (
                  <InlineStack align="center">
                    <Pagination
                      hasPrevious={page > 1}
                      onPrevious={() => void changePage(page - 1)}
                      hasNext={page < totalPages}
                      onNext={() => void changePage(page + 1)}
                      label={`Page ${page} of ${totalPages}`}
                    />
                  </InlineStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">Recent jobs</Text>
              {recentJobs.length === 0 ? (
                <Text as="p" tone="subdued">No jobs run yet in this session.</Text>
              ) : (
                <BlockStack gap="0">
                  <Box paddingBlockEnd="200">
                    <InlineGrid columns={{ xs: 1, md: "2fr 1fr 1fr 1fr 1fr 0.6fr" }} gap="200">
                      <Text as="span" tone="subdued" variant="bodySm" fontWeight="medium">Store</Text>
                      <Text as="span" tone="subdued" variant="bodySm" fontWeight="medium">Type</Text>
                      <Text as="span" tone="subdued" variant="bodySm" fontWeight="medium">Status</Text>
                      <Text as="span" tone="subdued" variant="bodySm" fontWeight="medium">Products</Text>
                      <Text as="span" tone="subdued" variant="bodySm" fontWeight="medium">Started at</Text>
                      <Text as="span" tone="subdued" variant="bodySm" fontWeight="medium">{" "}</Text>
                    </InlineGrid>
                  </Box>
                  {recentJobs.map((j) => (
                    <Box key={j.id} paddingBlock="200" borderBlockStartWidth="025" borderColor="border-secondary">
                      <InlineGrid columns={{ xs: 1, md: "2fr 1fr 1fr 1fr 1fr 0.6fr" }} gap="200">
                        <InlineStack gap="150" blockAlign="center">
                          <Icon source={PLATFORM_INFO[j.options.platform].icon} tone="subdued" />
                          <Text as="span" variant="bodySm" truncate>
                            {(() => {
                              try {
                                return new URL(j.options.inputUrl).hostname;
                              } catch {
                                return j.options.inputUrl;
                              }
                            })()}
                          </Text>
                        </InlineStack>
                        <Text as="span" variant="bodySm">{j.options.scope === "store" ? "Entire store" : "Collection"}</Text>
                        <StatusBadge status={j.status} />
                        <Text as="span" variant="bodySm">{j.productCount}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {new Date(j.createdAt).toLocaleString()}
                        </Text>
                        <Button size="micro" onClick={() => openJob(j.id)} disabled={job?.id === j.id}>
                          {job?.id === j.id ? "Current" : "Open"}
                        </Button>
                      </InlineGrid>
                    </Box>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
