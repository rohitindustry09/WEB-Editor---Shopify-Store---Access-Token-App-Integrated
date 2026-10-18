import "server-only";
import type { Finding, ParsedPage, SocialPresence } from "./types";

const SOCIAL_PLATFORMS: { platform: string; pattern: RegExp }[] = [
  { platform: "Facebook", pattern: /(^|\.)facebook\.com$/i },
  { platform: "Instagram", pattern: /(^|\.)instagram\.com$/i },
  { platform: "YouTube", pattern: /(^|\.)(youtube\.com|youtu\.be)$/i },
  { platform: "X (Twitter)", pattern: /(^|\.)(twitter\.com|x\.com)$/i },
  { platform: "LinkedIn", pattern: /(^|\.)linkedin\.com$/i },
  { platform: "Pinterest", pattern: /(^|\.)pinterest\.(com|[a-z]{2})$/i },
];

/**
 * Share buttons ("tweet this", "share on Facebook") point at the social
 * platform but are NOT the brand's own profile. Confirmed against a real
 * store: a product page's X share button (twitter.com/intent/tweet?...)
 * was being counted as "has an X profile" when the site genuinely has
 * none — a false pass on exactly the check that's supposed to catch it.
 */
const SHARE_PATH_SEGMENTS = ["intent", "share", "sharer", "share_channel", "sharearticle", "submit"];

/** True when the URL path's first segment is a share/compose endpoint rather than a profile. Plain string comparison rather than a regex — the escaping on a pattern containing a literal `/` is exactly what silently broke an earlier version of this check. */
function isShareUrl(pathname: string): boolean {
  const firstSegment = pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  return SHARE_PATH_SEGMENTS.some((segment) => firstSegment === segment || firstSegment.startsWith(`${segment}.`));
}

/**
 * Looks for links to each social platform anywhere in the crawled pages —
 * matched on the link's HOSTNAME rather than a substring of the whole URL,
 * so a link to `example.com/?ref=facebook.com` doesn't count as having a
 * Facebook page, and share/intent URLs are excluded per above.
 */
export function checkSocialPresence(pages: ParsedPage[], homepageUrl: string): {
  presence: SocialPresence[];
  findings: Finding[];
} {
  const found = new Map<string, string>();

  for (const page of pages) {
    for (const link of page.links) {
      let hostname: string;
      try {
        hostname = new URL(link.href, page.url).hostname;
      } catch {
        continue;
      }
      let pathname: string;
      try {
        pathname = new URL(link.href, page.url).pathname;
      } catch {
        continue;
      }
      if (isShareUrl(pathname)) continue;

      for (const { platform, pattern } of SOCIAL_PLATFORMS) {
        if (!found.has(platform) && pattern.test(hostname)) {
          try {
            found.set(platform, new URL(link.href, page.url).toString());
          } catch {
            // Unresolvable — treat as not found rather than storing a broken value.
          }
        }
      }
    }
  }

  const presence: SocialPresence[] = SOCIAL_PLATFORMS.map(({ platform }) => ({
    platform,
    url: found.get(platform) ?? null,
  }));

  const missing = presence.filter((p) => !p.url).map((p) => p.platform);
  const findings: Finding[] = [];
  if (missing.length > 0) {
    findings.push({
      category: "social",
      severity: "info",
      page: homepageUrl,
      message: `No link found to: ${missing.join(", ")}.`,
      recommendation: "If you have profiles on these, link them from the site — it helps visitors find you and reinforces that the brand is legitimate. Skip any platform you genuinely don't use.",
    });
  }

  return { presence, findings };
}
