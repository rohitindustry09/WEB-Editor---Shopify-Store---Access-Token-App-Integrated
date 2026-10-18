import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { safeFetch, SsrfBlockedError } from "@/lib/seoAudit/safeFetch";
import { checkRobotsTxt } from "@/lib/storeScraper/robotsCheck";

export async function POST(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;
  let payload: { url?: unknown; allowInsecureTls?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  if (typeof payload.url !== "string" || payload.url.trim().length === 0) {
    return NextResponse.json({ ok: false, message: "Enter a store URL first." });
  }

  let url: string;
  try {
    url = new URL(payload.url.trim()).toString();
  } catch {
    return NextResponse.json({ ok: false, message: "That doesn't look like a valid URL." });
  }

  try {
    const allowInsecureTls = Boolean(payload.allowInsecureTls);
    let result = await safeFetch(url, { method: "HEAD", timeoutMs: 8000, allowInsecureTls });
    // Some stores reject HEAD outright (405) even though GET works fine —
    // fall back once rather than reporting a false negative.
    if (result.status === 405 || result.status === 404) {
      result = await safeFetch(url, { method: "GET", timeoutMs: 8000, allowInsecureTls });
    }
    if (result.status >= 200 && result.status < 400) {
      const robots = await checkRobotsTxt(url, allowInsecureTls);
      const robotsWarning = robots.disallowed
        ? `robots.txt disallows "${robots.matchedRule}" for all crawlers — scraping this path may go against the site's own stated policy.`
        : robots.crawlDelaySeconds
          ? `robots.txt requests a ${robots.crawlDelaySeconds}s crawl delay — this tool paces requests adaptively but doesn't currently enforce that exact figure.`
          : null;
      return NextResponse.json({ ok: true, message: "Store is accessible", robotsWarning });
    }
    return NextResponse.json({ ok: false, message: `Store responded with status ${result.status}.` });
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return NextResponse.json({ ok: false, message: err.message });
    }
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "Couldn't reach that URL." });
  }
}
