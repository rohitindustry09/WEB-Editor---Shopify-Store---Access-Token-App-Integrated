"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  TextField,
  Button,
  Banner,
  Badge,
  Box,
  Tabs,
  Icon,
  ProgressBar,
  Divider,
  Spinner,
} from "@shopify/polaris";
import { Select } from "@/components/ui/Select";
import { SearchIcon, CheckCircleIcon, AlertTriangleIcon, XCircleIcon, GlobeIcon } from "@shopify/polaris-icons";
import { AUDIT_STEPS, DEFAULT_MAX_PAGES, MAX_PAGES_OPTIONS, type AuditStepId } from "@/lib/seoAudit/constants";
import type { AuditEvent } from "@/lib/seoAudit/runAudit";
import type {
  AuditCategory,
  Finding,
  Severity,
  SeoAuditReport,
  PerformanceMetrics,
} from "@/lib/seoAudit/types";

const SEVERITY_TONE: Record<Severity, "critical" | "warning" | "info"> = {
  critical: "critical",
  warning: "warning",
  info: "info",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

const CATEGORY_LABEL: Record<AuditCategory, string> = {
  "on-page": "On-page SEO",
  technical: "Technical SEO",
  "broken-links": "Broken links & images",
  "structured-data": "Structured data",
  performance: "Page speed & Core Web Vitals",
  social: "Social media",
};

/** Google's own published Core Web Vitals bands — the same good/needs-work/poor cutoffs pagespeed.web.dev uses. */
function vitalTone(value: number | null, good: number, poor: number): "success" | "warning" | "critical" | undefined {
  if (value === null) return undefined;
  if (value <= good) return "success";
  if (value <= poor) return "warning";
  return "critical";
}

function scoreTone(score: number): "success" | "warning" | "critical" {
  if (score >= 90) return "success";
  if (score >= 50) return "warning";
  return "critical";
}

function scoreColor(score: number): string {
  if (score >= 90) return "var(--p-color-text-success)";
  if (score >= 50) return "var(--p-color-text-caution)";
  return "var(--p-color-text-critical)";
}

function groupFindingsByPage(findings: Finding[]): Map<string, Finding[]> {
  const byPage = new Map<string, Finding[]>();
  for (const finding of findings) {
    const list = byPage.get(finding.page) ?? [];
    list.push(finding);
    byPage.set(finding.page, list);
  }
  return byPage;
}

/** A raw URL slug ("brass-lord-ganesha-on-swing") isn't a page's real name — this is only the fallback for when the page has no <title> to use instead (a fetch failure, or a title-less page). */
function titleCaseFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Turns a crawled URL into a human page label — "Home" for the root,
 * "Product: <name>" / "Collection: <name>" for Shopify's own URL shape,
 * falling back to the page's own <title> (or, failing that, its URL slug)
 * for anything else. Real Shopify path conventions, not a guess.
 */
function getPageLabel(url: string, title: string | null | undefined): { kind: string; name: string } {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return { kind: "", name: title || url };
  }

  if (pathname === "/" || pathname === "") {
    return { kind: "", name: "Home" };
  }

  const productMatch = pathname.match(/^\/products\/([^/]+)\/?$/);
  if (productMatch) return { kind: "Product", name: title || titleCaseFromSlug(productMatch[1]) };

  const collectionMatch = pathname.match(/^\/collections\/([^/]+)\/?$/);
  if (collectionMatch) return { kind: "Collection", name: title || titleCaseFromSlug(collectionMatch[1]) };

  const pageMatch = pathname.match(/^\/pages\/([^/]+)\/?$/);
  if (pageMatch) return { kind: "Page", name: title || titleCaseFromSlug(pageMatch[1]) };

  const blogArticleMatch = pathname.match(/^\/blogs\/[^/]+\/([^/]+)\/?$/);
  if (blogArticleMatch) return { kind: "Article", name: title || titleCaseFromSlug(blogArticleMatch[1]) };

  const segments = pathname.split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1] ?? pathname;
  return { kind: "", name: title || titleCaseFromSlug(lastSegment) };
}

const SEVERITY_CIRCLE_COLOR: Record<Severity, { bg: string; fg: string }> = {
  critical: { bg: "var(--p-color-bg-fill-critical)", fg: "var(--p-color-text-critical-on-bg-fill)" },
  warning: { bg: "var(--p-color-bg-fill-caution)", fg: "var(--p-color-text-caution-on-bg-fill)" },
  info: { bg: "var(--p-color-bg-fill-info)", fg: "var(--p-color-text-info-on-bg-fill)" },
};

/** A small colored circle with a count inside — Polaris's Badge is pill-shaped, not circular, so this is a minimal custom element rather than a mis-used Badge. */
function CountCircle({ count, tone }: { count: number; tone: Severity | "success" }) {
  const { bg, fg } =
    tone === "success"
      ? { bg: "var(--p-color-bg-fill-success)", fg: "var(--p-color-text-success-on-bg-fill)" }
      : SEVERITY_CIRCLE_COLOR[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 22,
        height: 22,
        padding: "0 6px",
        borderRadius: 999,
        background: bg,
        color: fg,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1,
      }}
    >
      {count}
    </span>
  );
}

/** The per-page header's own total-issue summary: one severity's circle per non-zero bucket (worst first), or a single green check circle when the page is clean. */
/** A card section's title with a thin rule trailing off to the right of it — the clean report-card look (label, then a hairline the rest of the way across), used at the top of every section in this tool instead of a plain heading. */
function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
      <InlineStack gap="300" blockAlign="center" wrap={false}>
        <Text as="h2" variant="headingSm" fontWeight="semibold">{title}</Text>
        <div style={{ flex: 1, minWidth: 24, height: 1, background: "var(--p-color-border-secondary)" }} />
      </InlineStack>
      {action}
    </InlineStack>
  );
}

/** Label above, a large bold number, an optional small colored note below — the plain (no colored fill) stat pattern used throughout the reference report's own "Summary" rows, reused here for both the live crawl stats and the finished report's headline numbers. */
function StatBlock({ label, value, note, noteTone }: { label: string; value: string; note?: string; noteTone?: "critical" | "success" | "subdued" }) {
  return (
    <BlockStack gap="050">
      <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
      <Text as="p" variant="heading2xl" fontWeight="bold">{value}</Text>
      {note && (
        <Text as="span" variant="bodySm" tone={noteTone}>
          {note}
        </Text>
      )}
    </BlockStack>
  );
}

function PageIssueSummary({ findings }: { findings: Finding[] }) {
  const counts = {
    critical: findings.filter((f) => f.severity === "critical").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
  };
  if (counts.critical === 0 && counts.warning === 0 && counts.info === 0) {
    return (
      <InlineStack gap="100" blockAlign="center">
        <CountCircle count={0} tone="success" />
        <Text as="span" tone="subdued" variant="bodySm">No issues</Text>
      </InlineStack>
    );
  }
  return (
    <InlineStack gap="150" blockAlign="center">
      {counts.critical > 0 && <CountCircle count={counts.critical} tone="critical" />}
      {counts.warning > 0 && <CountCircle count={counts.warning} tone="warning" />}
      {counts.info > 0 && <CountCircle count={counts.info} tone="info" />}
      <Text as="span" tone="subdued" variant="bodySm">
        {findings.length} issue{findings.length === 1 ? "" : "s"}
      </Text>
    </InlineStack>
  );
}

function VitalRow({ label, value, unit, tone, target }: { label: string; value: number | null; unit: string; tone?: "success" | "warning" | "critical"; target: string }) {
  return (
    <InlineStack align="space-between" blockAlign="center" gap="200">
      <BlockStack gap="0">
        <Text as="span" fontWeight="medium">{label}</Text>
        <Text as="span" tone="subdued" variant="bodySm">Target: {target}</Text>
      </BlockStack>
      {value === null ? (
        <Text as="span" tone="subdued" variant="bodySm">Not available</Text>
      ) : (
        <Badge tone={tone}>{`${value}${unit}`}</Badge>
      )}
    </InlineStack>
  );
}

function PerformanceSection({ performance }: { performance: PerformanceMetrics }) {
  if (performance.error) {
    return (
      <Card>
        <BlockStack gap="300">
          <SectionHeading title="Page speed & Core Web Vitals" />
          <Banner tone="info">
            <p>{performance.error}</p>
          </Banner>
        </BlockStack>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        <SectionHeading
          title="Page speed & Core Web Vitals"
          action={
            <Text as="span" tone="subdued" variant="bodySm">
              Real data from Google PageSpeed Insights ({performance.strategy})
            </Text>
          }
        />

        {performance.performanceScore !== null && (
          <BlockStack gap="150">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" fontWeight="medium">Lighthouse performance score</Text>
              <Text as="span" variant="headingLg">
                <span style={{ color: scoreColor(performance.performanceScore) }}>
                  {performance.performanceScore}/100
                </span>
              </Text>
            </InlineStack>
            <ProgressBar progress={performance.performanceScore} tone={scoreTone(performance.performanceScore) === "success" ? "success" : scoreTone(performance.performanceScore) === "warning" ? "highlight" : "critical"} size="small" />
          </BlockStack>
        )}

        <Divider />

        <BlockStack gap="300">
          <VitalRow label="Largest Contentful Paint (LCP)" value={performance.lcpSeconds} unit="s" target="under 2.5s" tone={vitalTone(performance.lcpSeconds, 2.5, 4)} />
          <VitalRow label="Cumulative Layout Shift (CLS)" value={performance.cls} unit="" target="under 0.1" tone={vitalTone(performance.cls, 0.1, 0.25)} />
          <VitalRow label="Interaction to Next Paint (INP)" value={performance.inpMs} unit="ms" target="under 200ms" tone={vitalTone(performance.inpMs, 200, 500)} />
          <VitalRow label="First Contentful Paint (FCP)" value={performance.fcpSeconds} unit="s" target="under 1.8s" tone={vitalTone(performance.fcpSeconds, 1.8, 3)} />
          <VitalRow label="Total Blocking Time (TBT)" value={performance.tbtMs} unit="ms" target="under 200ms" tone={vitalTone(performance.tbtMs, 200, 600)} />
        </BlockStack>

        {performance.inpMs === null && (
          <Text as="p" tone="subdued" variant="bodySm">
            INP comes from real visitor data Google collects — it&apos;s blank when a site doesn&apos;t yet have
            enough traffic for Google to report it, not because anything is wrong.
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

type StepStatus = "pending" | "running" | "done";
interface StepState {
  status: StepStatus;
  detail?: string;
}
type StepStates = Record<AuditStepId, StepState>;

function initialStepStates(): StepStates {
  return Object.fromEntries(AUDIT_STEPS.map((step) => [step.id, { status: "pending" as StepStatus }])) as StepStates;
}

/** The audit's own live timeline — every step this tool runs, in order, each one showing pending/running/done as the stream reports it. This is the "show all works to the front" piece: nothing here is a guess about what's happening, every state change is a real event from the server. */
function StepTimeline({ states }: { states: StepStates }) {
  return (
    <InlineStack gap="400" wrap>
      {AUDIT_STEPS.map((step) => {
        const state = states[step.id];
        return (
          <InlineStack key={step.id} gap="150" blockAlign="center" wrap={false}>
            {state.status === "running" ? (
              <Spinner size="small" />
            ) : state.status === "done" ? (
              <Icon source={CheckCircleIcon} tone="success" />
            ) : (
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--p-color-border-secondary)",
                  display: "inline-block",
                }}
              />
            )}
            <Text as="span" variant="bodySm" fontWeight={state.status === "running" ? "semibold" : undefined} tone={state.status === "pending" ? "subdued" : undefined}>
              {step.label}
            </Text>
            {state.detail && (
              <Text as="span" variant="bodySm" tone="subdued">
                ({state.detail})
              </Text>
            )}
          </InlineStack>
        );
      })}
    </InlineStack>
  );
}

interface CrawlStats {
  crawled: number;
  queued: number;
  errors: number;
  skipped: number;
}

function CrawlStatsRow({ stats, maxPages }: { stats: CrawlStats; maxPages: number }) {
  return (
    <InlineStack gap="800" wrap>
      <StatBlock label="Pages crawled" value={stats.crawled.toLocaleString()} />
      <StatBlock label="Still queued" value={stats.queued.toLocaleString()} />
      <StatBlock label="Skipped (non-HTML)" value={stats.skipped.toLocaleString()} />
      <StatBlock label="Errors" value={stats.errors.toLocaleString()} note={stats.errors > 0 ? "check the feed below" : undefined} noteTone={stats.errors > 0 ? "critical" : undefined} />
      <StatBlock label="Crawl limit" value={maxPages.toLocaleString()} />
    </InlineStack>
  );
}

interface CrawlFeedRow {
  key: string;
  url: string;
  title: string | null;
  status: number | null;
  kind: "crawled" | "skipped" | "error";
  message?: string;
}

const FEED_LIMIT = 60;

function CrawlFeedItem({ row }: { row: CrawlFeedRow }) {
  const label = getPageLabel(row.url, row.title);
  const icon = row.kind === "crawled" ? CheckCircleIcon : row.kind === "skipped" ? AlertTriangleIcon : XCircleIcon;
  const tone = row.kind === "crawled" ? "success" : row.kind === "skipped" ? "caution" : "critical";
  return (
    <Box padding="200" borderBlockEndWidth="025" borderColor="border-secondary">
      <InlineStack gap="200" blockAlign="center" wrap={false}>
        <Icon source={icon} tone={tone} />
        <BlockStack gap="0">
          <InlineStack gap="150" blockAlign="baseline">
            {label.kind && <Text as="span" tone="subdued" variant="bodySm">{label.kind}:</Text>}
            <Text as="span" variant="bodySm" fontWeight="medium">{label.name}</Text>
            {row.status !== null && <Text as="span" tone="subdued" variant="bodySm">HTTP {row.status}</Text>}
          </InlineStack>
          <Text as="span" tone="subdued" variant="bodySm" breakWord>
            {row.message ?? row.url}
          </Text>
        </BlockStack>
      </InlineStack>
    </Box>
  );
}

/** A live, newest-first feed of exactly what the crawler has found — real per-page results streaming in, not a single progress bar standing in for the work. Capped at `FEED_LIMIT` rows shown (the crawl stats above stay accurate for the full count regardless). */
function LiveCrawlFeed({ rows }: { rows: CrawlFeedRow[] }) {
  if (rows.length === 0) {
    return (
      <Box padding="400">
        <InlineStack gap="200" blockAlign="center">
          <Spinner size="small" />
          <Text as="span" tone="subdued">Waiting for the first page…</Text>
        </InlineStack>
      </Box>
    );
  }
  return (
    <div style={{ maxHeight: 360, overflowY: "auto" }}>
      <BlockStack gap="0">
        {rows.map((row) => (
          <CrawlFeedItem key={row.key} row={row} />
        ))}
      </BlockStack>
    </div>
  );
}

type StreamLine = AuditEvent | { type: "done"; report: SeoAuditReport };

export function SeoAuditForm({ defaultDomain }: { defaultDomain: string }) {
  const [domain, setDomain] = useState(defaultDomain);
  const [maxPages, setMaxPages] = useState<number>(DEFAULT_MAX_PAGES);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<SeoAuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState(0);
  const [categoryTab, setCategoryTab] = useState(0);

  const [stepStates, setStepStates] = useState<StepStates>(initialStepStates);
  const [feed, setFeed] = useState<CrawlFeedRow[]>([]);
  const [stats, setStats] = useState<CrawlStats>({ crawled: 0, queued: 0, errors: 0, skipped: 0 });
  const [sitemapInfo, setSitemapInfo] = useState<{ found: boolean; url: string | null; pageCount: number } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Same "buffer, then flush on a short timer" pattern used for the media
  // tools' worker-driven progress: the crawl can report several pages in a
  // burst (6-way concurrency), and one `setState` per single page result
  // risks the same rapid-fire-update issue already fixed there.
  const feedBufferRef = useRef<CrawlFeedRow[]>([]);
  const statsRef = useRef<CrawlStats>({ crawled: 0, queued: 0, errors: 0, skipped: 0 });
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedKeyRef = useRef(0);

  const flush = () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (feedBufferRef.current.length > 0) {
      const newest = feedBufferRef.current.slice().reverse();
      feedBufferRef.current = [];
      setFeed((prev) => [...newest, ...prev].slice(0, FEED_LIMIT));
    }
    setStats({ ...statsRef.current });
  };
  const scheduleFlush = () => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flush();
    }, 120);
  };
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, []);

  const handleEvent = (event: StreamLine) => {
    switch (event.type) {
      case "robots-checked":
        setStepStates((prev) => ({ ...prev, robots: { status: "done", detail: event.found ? "found" : "not found" } }));
        break;
      case "sitemap-checked":
        setSitemapInfo({ found: event.found, url: event.url, pageCount: event.pageCount });
        setStepStates((prev) => ({
          ...prev,
          sitemap: { status: "done", detail: event.found ? `${event.pageCount} URLs` : "none found" },
        }));
        break;
      case "page-queued":
        statsRef.current = { ...statsRef.current, queued: event.queueSize };
        scheduleFlush();
        break;
      case "page-crawled":
        statsRef.current = { ...statsRef.current, crawled: event.crawledCount, queued: event.queueSize };
        feedKeyRef.current += 1;
        feedBufferRef.current.push({
          key: `crawled-${feedKeyRef.current}`,
          url: event.url,
          title: event.title,
          status: event.status,
          kind: "crawled",
        });
        scheduleFlush();
        break;
      case "page-skipped":
        statsRef.current = { ...statsRef.current, crawled: event.crawledCount, skipped: statsRef.current.skipped + 1 };
        feedKeyRef.current += 1;
        feedBufferRef.current.push({ key: `skipped-${feedKeyRef.current}`, url: event.url, title: null, status: null, kind: "skipped", message: `Skipped — ${event.reason}` });
        scheduleFlush();
        break;
      case "page-error":
        statsRef.current = { ...statsRef.current, crawled: event.crawledCount, errors: statsRef.current.errors + 1 };
        feedKeyRef.current += 1;
        feedBufferRef.current.push({ key: `error-${feedKeyRef.current}`, url: event.url, title: null, status: null, kind: "error", message: event.message });
        scheduleFlush();
        break;
      case "step-start":
        setStepStates((prev) => ({ ...prev, [event.id]: { status: "running" } }));
        break;
      case "step-done":
        setStepStates((prev) => ({ ...prev, [event.id]: { status: "done", detail: event.detail } }));
        break;
      case "done":
        flush();
        setReport(event.report);
        setFilterTab(0);
        setCategoryTab(0);
        break;
      case "fatal-error":
        flush();
        setError(event.message);
        break;
    }
  };

  const resetLiveState = () => {
    feedBufferRef.current = [];
    statsRef.current = { crawled: 0, queued: 0, errors: 0, skipped: 0 };
    feedKeyRef.current = 0;
    setFeed([]);
    setStats({ crawled: 0, queued: 0, errors: 0, skipped: 0 });
    setSitemapInfo(null);
    setStepStates(initialStepStates());
  };

  const runAudit = async () => {
    setError(null);
    setReport(null);
    resetLiveState();
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/seo-audit/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, maxPages }),
        signal: controller.signal,
      });
      if (!res.body) throw new Error("Couldn't start the audit — no response stream.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) handleEvent(JSON.parse(line) as StreamLine);
        }
      }
      if (buffer.trim()) handleEvent(JSON.parse(buffer) as StreamLine);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Audit cancelled.");
      } else {
        setError(err instanceof Error ? err.message : "Couldn't run the audit.");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancelAudit = () => {
    abortRef.current?.abort();
  };

  const findingsByPage = report ? groupFindingsByPage(report.findings) : new Map<string, Finding[]>();

  // Category tab 0 is always "All categories" — every category after that
  // comes straight from the backend's own category order, so this list
  // never drifts out of sync with categoryScores.
  const categoryTabs = [
    { id: "all-categories", content: `All categories (${report?.overallScore ?? 0}%)` },
    ...(report?.categoryScores.map((cat) => ({
      id: cat.category,
      content: `${CATEGORY_LABEL[cat.category]} (${cat.score}%)`,
    })) ?? []),
  ];
  const activeCategory: AuditCategory | null =
    categoryTab > 0 ? report?.categoryScores[categoryTab - 1]?.category ?? null : null;

  // Severity tab counts reflect whichever category is selected above, so
  // picking "Broken links" and then "Critical" narrows to exactly that
  // intersection rather than the whole site's critical count.
  const categoryScopedFindings = report
    ? activeCategory
      ? report.findings.filter((f) => f.category === activeCategory)
      : report.findings
    : [];
  const scopedSeverityCounts = {
    critical: categoryScopedFindings.filter((f) => f.severity === "critical").length,
    warning: categoryScopedFindings.filter((f) => f.severity === "warning").length,
    info: categoryScopedFindings.filter((f) => f.severity === "info").length,
  };
  const filterTabs = [
    { id: "all", content: `All (${categoryScopedFindings.length})` },
    { id: "critical", content: `Critical (${scopedSeverityCounts.critical})` },
    { id: "warning", content: `Warning (${scopedSeverityCounts.warning})` },
    { id: "info", content: `Info (${scopedSeverityCounts.info})` },
  ];
  const activeSeverity: Severity | null =
    filterTab === 1 ? "critical" : filterTab === 2 ? "warning" : filterTab === 3 ? "info" : null;

  const maxPagesOptions = MAX_PAGES_OPTIONS.map((n) => ({ value: String(n), label: `${n} pages` }));

  return (
    <Page
      fullWidth
      title="SEO audit"
      subtitle="Personal tool — crawls a domain live, checks on-page SEO, technical health, structured data, links, and real Core Web Vitals. Doesn't touch your store."
      backAction={{ content: "Store connection", url: "/settings/connection" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <SectionHeading title="Run an audit" />
              <Text as="p" tone="subdued">
                Does a real crawl — starting from the sitemap when there is one, then following every same-origin
                link it finds on every page it visits, not just the homepage — up to the page limit below. Watch it
                work in real time: every page fetched, every check run, shows up live as it happens.
              </Text>

              <InlineStack gap="300" blockAlign="end" wrap={false}>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Domain"
                    labelHidden
                    autoComplete="off"
                    placeholder="example.com"
                    value={domain}
                    onChange={setDomain}
                    disabled={running}
                    prefix={<Icon source={SearchIcon} tone="subdued" />}
                  />
                </div>
                <div style={{ minWidth: 150 }}>
                  <Select
                    label="Pages to crawl"
                    labelHidden
                    options={maxPagesOptions}
                    value={String(maxPages)}
                    onChange={(v) => setMaxPages(Number(v))}
                    disabled={running}
                  />
                </div>
                {running ? (
                  <Button tone="critical" onClick={cancelAudit}>
                    Cancel
                  </Button>
                ) : (
                  <Button variant="primary" loading={running} disabled={!domain.trim()} onClick={runAudit}>
                    Run audit
                  </Button>
                )}
              </InlineStack>

              {error && (
                <Banner tone="critical" title="Couldn't run this audit" onDismiss={() => setError(null)}>
                  <p>{error}</p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {running && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <SectionHeading
                  title={`Crawling ${domain || "your store"}…`}
                  action={<Icon source={GlobeIcon} tone="subdued" />}
                />

                <StepTimeline states={stepStates} />
                <Divider />
                <CrawlStatsRow stats={stats} maxPages={maxPages} />

                {sitemapInfo && (
                  <Text as="p" tone="subdued" variant="bodySm">
                    {sitemapInfo.found
                      ? `Found a sitemap at ${sitemapInfo.url} listing ${sitemapInfo.pageCount} URLs — crawling those first, then following any further links they lead to.`
                      : "No sitemap found — following links from the homepage instead."}
                  </Text>
                )}

                <Card padding="0">
                  <Box padding="200" borderBlockEndWidth="025" borderColor="border">
                    <Text as="span" variant="bodySm" fontWeight="medium" tone="subdued">
                      Live crawl feed
                    </Text>
                  </Box>
                  <LiveCrawlFeed rows={feed} />
                </Card>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {report && (
          <Layout.Section>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <SectionHeading
                    title="Summary"
                    action={
                      <Text as="span" tone="subdued" variant="bodySm">
                        {new Date(report.generatedAt).toLocaleString()}
                      </Text>
                    }
                  />

                  <Text as="span" tone="subdued" variant="bodySm">
                    {report.domain} — {report.pagesCrawled.length} page
                    {report.pagesCrawled.length === 1 ? "" : "s"} crawled
                    {report.usedSitemap ? " (seeded from sitemap.xml, then link-followed)" : " (found entirely by following links — no sitemap found)"}
                  </Text>

                  <InlineStack gap="800" wrap>
                    <StatBlock
                      label="SEO score"
                      value={String(report.overallScore)}
                      note={report.overallScore >= 90 ? "Healthy" : report.overallScore >= 50 ? "Needs attention" : "Poor"}
                      noteTone={scoreTone(report.overallScore) === "success" ? "success" : scoreTone(report.overallScore) === "critical" ? "critical" : "subdued"}
                    />
                    <StatBlock label="Pages crawled" value={report.pagesCrawled.length.toLocaleString()} />
                    <StatBlock
                      label="Critical issues"
                      value={report.severityCounts.critical.toLocaleString()}
                      noteTone={report.severityCounts.critical > 0 ? "critical" : "subdued"}
                    />
                    <StatBlock label="Warnings" value={report.severityCounts.warning.toLocaleString()} />
                    <StatBlock label="Info notes" value={report.severityCounts.info.toLocaleString()} />
                  </InlineStack>

                  <BlockStack gap="200">
                    <Text as="span" variant="bodySm" fontWeight="medium" tone="subdued">By category</Text>
                    {report.categoryScores.map((cat) => (
                      <BlockStack gap="050" key={cat.category}>
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" variant="bodySm" fontWeight="medium">
                            {CATEGORY_LABEL[cat.category]}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">{cat.score}%</Text>
                        </InlineStack>
                        <ProgressBar
                          progress={cat.score}
                          size="small"
                          tone={scoreTone(cat.score) === "success" ? "success" : scoreTone(cat.score) === "warning" ? "highlight" : "critical"}
                        />
                      </BlockStack>
                    ))}
                  </BlockStack>

                  <Text as="p" tone="subdued" variant="bodySm">
                    This score is computed by this tool from the findings below — it isn&apos;t Semrush&apos;s
                    or any other vendor&apos;s score, and isn&apos;t comparable to one.
                  </Text>
                </BlockStack>
              </Card>

              {report.performance && <PerformanceSection performance={report.performance} />}

              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                <Card>
                  <BlockStack gap="300">
                    <SectionHeading title="Social media presence" />
                    <BlockStack gap="200">
                      {report.social.map((s) => (
                        <InlineStack key={s.platform} align="space-between" blockAlign="center">
                          <Text as="span">{s.platform}</Text>
                          {s.url ? (
                            <InlineStack gap="100" blockAlign="center">
                              <Icon source={CheckCircleIcon} tone="success" />
                              <Text as="span" tone="subdued" variant="bodySm" breakWord>Linked</Text>
                            </InlineStack>
                          ) : (
                            <InlineStack gap="100" blockAlign="center">
                              <Icon source={AlertTriangleIcon} tone="caution" />
                              <Text as="span" tone="subdued" variant="bodySm">Not linked</Text>
                            </InlineStack>
                          )}
                        </InlineStack>
                      ))}
                    </BlockStack>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="300">
                    <SectionHeading
                      title="Keyword density"
                      action={
                        <Text as="span" tone="subdued" variant="bodySm">
                          {report.homepageWordCount.toLocaleString()} words
                        </Text>
                      }
                    />
                    {report.keywordDensity.length === 0 ? (
                      <Text as="p" tone="subdued" variant="bodySm">No text content found to analyze.</Text>
                    ) : (
                      <BlockStack gap="150">
                        {report.keywordDensity.slice(0, 10).map((k) => (
                          <InlineStack key={k.keyword} align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm">{k.keyword}</Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {k.instances}× · {k.density}%
                            </Text>
                          </InlineStack>
                        ))}
                      </BlockStack>
                    )}
                    <Text as="p" tone="subdued" variant="bodySm">
                      Counted from this page&apos;s own text. Search volume and ranking data would need a paid
                      keyword database, so it isn&apos;t shown rather than guessed at.
                    </Text>
                  </BlockStack>
                </Card>
              </InlineGrid>

              <Card padding="0">
                <Box padding="200" paddingInlineEnd="300" borderBlockEndWidth="025" borderColor="border">
                  <Tabs
                    tabs={categoryTabs}
                    selected={categoryTab}
                    onSelect={(index) => {
                      setCategoryTab(index);
                      setFilterTab(0);
                    }}
                  />
                </Box>
                <Box padding="200" paddingInlineEnd="300">
                  <Tabs tabs={filterTabs} selected={filterTab} onSelect={setFilterTab} />
                </Box>
              </Card>

              {report.pagesCrawled.length === 0 ? (
                <Card>
                  <Text as="p" tone="subdued">No pages could be checked.</Text>
                </Card>
              ) : (
                // Every checked page gets listed here, by page name — not
                // just the ones with something wrong. On the "All" tab a
                // clean page shows its own "No issues found" line instead
                // of just disappearing, so it's clear which pages were
                // actually good versus never checked at all.
                report.pagesCrawled.map((pageUrl) => {
                  const pageFindings = (findingsByPage.get(pageUrl) ?? []).filter(
                    (f) => !activeCategory || f.category === activeCategory,
                  );
                  const visible = activeSeverity
                    ? pageFindings.filter((f) => f.severity === activeSeverity)
                    : pageFindings;
                  // A page with nothing in the selected category/severity is
                  // hidden entirely rather than shown with an empty "no
                  // issues" badge — that badge is reserved for the
                  // unfiltered view, where it actually means the page is
                  // clean, not just that the current filter excludes it.
                  if ((activeCategory || activeSeverity) && visible.length === 0) return null;

                  const label = getPageLabel(pageUrl, report.pageTitles[pageUrl]);

                  return (
                    <Card key={pageUrl} padding="0">
                      <Box padding="300" borderBlockEndWidth="025" borderColor="border" background="bg-surface-secondary">
                        <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
                          <Box minWidth="0">
                            <BlockStack gap="0">
                              <InlineStack gap="150" blockAlign="baseline" wrap={false}>
                                {label.kind && (
                                  <Text as="span" tone="subdued" variant="bodySm">{label.kind}:</Text>
                                )}
                                <Box minWidth="0">
                                  <a href={pageUrl} target="_blank" rel="noopener noreferrer">
                                    <Text as="h3" variant="headingSm" truncate>{label.name}</Text>
                                  </a>
                                </Box>
                              </InlineStack>
                              <Text as="span" tone="subdued" variant="bodySm" breakWord>{pageUrl}</Text>
                            </BlockStack>
                          </Box>
                          <PageIssueSummary findings={pageFindings} />
                        </InlineStack>
                      </Box>
                      {visible.length === 0 ? (
                        <Box padding="300">
                          <InlineStack gap="200" blockAlign="center">
                            <Badge tone="success">No issues found</Badge>
                          </InlineStack>
                        </Box>
                      ) : (
                        <BlockStack gap="0">
                          {visible.map((finding, index) => (
                            <Box key={index} padding="300" borderBlockEndWidth="025" borderColor="border">
                              <BlockStack gap="150">
                                <InlineStack gap="200" blockAlign="center">
                                  <Badge tone={SEVERITY_TONE[finding.severity]}>{SEVERITY_LABEL[finding.severity]}</Badge>
                                  <Badge>{CATEGORY_LABEL[finding.category]}</Badge>
                                </InlineStack>
                                <Text as="p" fontWeight="medium">{finding.message}</Text>
                                <Text as="p" tone="subdued" variant="bodySm">{finding.recommendation}</Text>
                              </BlockStack>
                            </Box>
                          ))}
                        </BlockStack>
                      )}
                    </Card>
                  );
                })
              )}
            </BlockStack>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
