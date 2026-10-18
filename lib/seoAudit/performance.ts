import "server-only";
import type { Finding, PerformanceMetrics, PerformanceStrategy } from "./types";

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const PSI_TIMEOUT_MS = 60_000;

interface PsiAudit {
  numericValue?: number;
}

interface PsiResponse {
  lighthouseResult?: {
    categories?: { performance?: { score?: number } };
    audits?: Record<string, PsiAudit>;
  };
  loadingExperience?: {
    metrics?: Record<string, { percentile?: number }>;
  };
  error?: { message?: string };
}

/**
 * Pulls real Lighthouse + Core Web Vitals numbers from Google's PageSpeed
 * Insights API — the same engine behind pagespeed.web.dev, and the same
 * metrics Google actually uses for ranking. Works without an API key at
 * low volume (which is all a single-admin tool needs); `PAGESPEED_API_KEY`
 * is used when set, purely to raise the rate limit.
 *
 * This is deliberately NOT a home-grown approximation of page speed: a
 * "page weight + render-blocking script count" heuristic would be inventing
 * numbers that look like Core Web Vitals without being them. Either the
 * real metrics come back, or the report says the API couldn't be reached.
 */
export async function fetchPerformance(
  url: string,
  strategy: PerformanceStrategy = "mobile",
): Promise<PerformanceMetrics> {
  const empty: PerformanceMetrics = {
    strategy,
    performanceScore: null,
    lcpSeconds: null,
    cls: null,
    inpMs: null,
    fcpSeconds: null,
    tbtMs: null,
    error: null,
  };

  const params = new URLSearchParams({ url, strategy, category: "performance" });
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (apiKey) params.set("key", apiKey);

  try {
    const res = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, {
      signal: AbortSignal.timeout(PSI_TIMEOUT_MS),
    });
    const data = (await res.json()) as PsiResponse;

    if (!res.ok || data.error) {
      return { ...empty, error: data.error?.message ?? `PageSpeed API returned ${res.status}.` };
    }

    const lighthouse = data.lighthouseResult;
    const audits = lighthouse?.audits ?? {};
    const rawScore = lighthouse?.categories?.performance?.score;
    // Field data (real users) for INP when Google has enough traffic on the
    // site to report it — low-traffic stores legitimately won't have this.
    const inpField = data.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile;

    return {
      strategy,
      performanceScore: typeof rawScore === "number" ? Math.round(rawScore * 100) : null,
      lcpSeconds: audits["largest-contentful-paint"]?.numericValue
        ? Number((audits["largest-contentful-paint"].numericValue! / 1000).toFixed(2))
        : null,
      cls: audits["cumulative-layout-shift"]?.numericValue
        ? Number(audits["cumulative-layout-shift"].numericValue!.toFixed(3))
        : null,
      inpMs: typeof inpField === "number" ? inpField : null,
      fcpSeconds: audits["first-contentful-paint"]?.numericValue
        ? Number((audits["first-contentful-paint"].numericValue! / 1000).toFixed(2))
        : null,
      tbtMs: audits["total-blocking-time"]?.numericValue
        ? Math.round(audits["total-blocking-time"].numericValue!)
        : null,
      error: null,
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : "Couldn't reach the PageSpeed API." };
  }
}

/** Google's own published Core Web Vitals thresholds — not invented cutoffs. */
export function checkPerformance(metrics: PerformanceMetrics, pageUrl: string): Finding[] {
  const findings: Finding[] = [];

  if (metrics.error) {
    findings.push({
      category: "performance",
      severity: "info",
      page: pageUrl,
      message: `Performance data unavailable: ${metrics.error}`,
      recommendation: "This section needs Google's PageSpeed Insights API — it may be rate-limited right now. Set PAGESPEED_API_KEY for a higher limit, or re-run the audit later.",
    });
    return findings;
  }

  if (metrics.performanceScore !== null && metrics.performanceScore < 50) {
    findings.push({
      category: "performance",
      severity: "critical",
      page: pageUrl,
      message: `Lighthouse performance score is ${metrics.performanceScore}/100 (${metrics.strategy}).`,
      recommendation: "Compress and correctly size images, remove unused CSS/JavaScript, and enable caching — below 50 is Google's 'poor' band.",
    });
  } else if (metrics.performanceScore !== null && metrics.performanceScore < 90) {
    findings.push({
      category: "performance",
      severity: "warning",
      page: pageUrl,
      message: `Lighthouse performance score is ${metrics.performanceScore}/100 (${metrics.strategy}).`,
      recommendation: "Decent but short of Google's 90+ 'good' band — image compression and trimming unused JavaScript are usually the biggest wins.",
    });
  }

  if (metrics.lcpSeconds !== null && metrics.lcpSeconds > 2.5) {
    findings.push({
      category: "performance",
      severity: metrics.lcpSeconds > 4 ? "critical" : "warning",
      page: pageUrl,
      message: `Largest Contentful Paint is ${metrics.lcpSeconds}s (Google's target is under 2.5s).`,
      recommendation: "Optimize and preload the main hero image, and cut down whatever blocks the initial render.",
    });
  }

  if (metrics.cls !== null && metrics.cls > 0.1) {
    findings.push({
      category: "performance",
      severity: metrics.cls > 0.25 ? "critical" : "warning",
      page: pageUrl,
      message: `Cumulative Layout Shift is ${metrics.cls} (Google's target is under 0.1).`,
      recommendation: "Set explicit width/height on images and ad/banner slots so content doesn't jump around as the page loads.",
    });
  }

  if (metrics.inpMs !== null && metrics.inpMs > 200) {
    findings.push({
      category: "performance",
      severity: metrics.inpMs > 500 ? "critical" : "warning",
      page: pageUrl,
      message: `Interaction to Next Paint is ${metrics.inpMs}ms from real user data (Google's target is under 200ms).`,
      recommendation: "Defer non-critical JavaScript and reduce third-party script work — taps and clicks currently feel sluggish to real visitors.",
    });
  }

  if (metrics.tbtMs !== null && metrics.tbtMs > 600) {
    findings.push({
      category: "performance",
      severity: "warning",
      page: pageUrl,
      message: `Total Blocking Time is ${metrics.tbtMs}ms — the main thread is busy long enough to block interaction.`,
      recommendation: "Break up long JavaScript tasks and move non-essential work off the critical path.",
    });
  }

  return findings;
}
