import "server-only";
import { safeFetch } from "@/lib/seoAudit/safeFetch";

export interface RobotsCheckResult {
  /** `null` when robots.txt couldn't be fetched at all (missing, blocked, timed out) — treated as "nothing found to disallow," not as an error, since most sites simply don't have one. */
  disallowed: boolean;
  /** The specific `Disallow:` rule that matched, if any — shown to the user so a warning isn't just "trust me." */
  matchedRule: string | null;
  crawlDelaySeconds: number | null;
}

/**
 * A deliberately simple robots.txt parser — just enough to answer "does the
 * `User-agent: *` block disallow the path we're about to scrape," not a
 * full spec implementation (no wildcard/`$`-anchor matching, no per-bot
 * sections beyond `*`). This is surfaced as an informational warning before
 * starting a scrape, never a hard block — the user owns the decision of
 * whether scraping their own target is fine; this just makes sure they're
 * not doing it blind.
 */
export async function checkRobotsTxt(targetUrl: string, allowInsecureTls: boolean): Promise<RobotsCheckResult> {
  const empty: RobotsCheckResult = { disallowed: false, matchedRule: null, crawlDelaySeconds: null };
  let origin: string;
  let path: string;
  try {
    const parsed = new URL(targetUrl);
    origin = parsed.origin;
    path = parsed.pathname || "/";
  } catch {
    return empty;
  }

  let body: string;
  try {
    const result = await safeFetch(`${origin}/robots.txt`, { method: "GET", timeoutMs: 6000, allowInsecureTls });
    if (result.status !== 200) return empty;
    body = result.body;
  } catch {
    return empty;
  }

  // Only the `User-agent: *` block — most robots.txt files that specifically
  // target known scraper bots (GPTBot, etc.) don't also restrict `*`, and
  // this tool doesn't identify as any of those anyway.
  let inWildcardBlock = false;
  let crawlDelaySeconds: number | null = null;
  const disallowRules: string[] = [];

  for (const rawLine of body.split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      inWildcardBlock = value === "*";
      continue;
    }
    if (!inWildcardBlock) continue;

    if (key === "disallow" && value) disallowRules.push(value);
    else if (key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) crawlDelaySeconds = seconds;
    }
  }

  const matchedRule = disallowRules.find((rule) => path.startsWith(rule)) ?? null;
  return { disallowed: matchedRule !== null, matchedRule, crawlDelaySeconds };
}
