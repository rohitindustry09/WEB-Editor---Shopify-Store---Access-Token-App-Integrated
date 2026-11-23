import { guardApi } from "@/lib/auth/apiGuard";
import { getSession } from "@/lib/shopify/session";
import { getPrimaryDomain } from "@/lib/seoAudit/liveStore";
import { readMeta, siteKey } from "@/lib/seoAudit/checkpoint";

export const dynamic = "force-dynamic";

/** Reduces whatever was typed (a URL, with or without www) to a bare host. */
function typedHost(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

/**
 * The saved-progress summary for a domain, so the page can offer "Resume" or "Start fresh" before a run.
 * The connected store is looked up by its primary domain, because that is the address its crawl is saved under.
 */
export async function GET(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;
  const typed = typedHost(new URL(request.url).searchParams.get("domain") ?? "");
  const session = await getSession();

  let host = typed;
  if (session) {
    const bare = typed.replace(/^www\./, "");
    const primary = await getPrimaryDomain();
    const primaryHost = primary?.host.toLowerCase().replace(/^www\./, "") ?? "";
    if (!bare || bare === session.shop.toLowerCase() || bare === primaryHost) host = primary?.host ?? typed;
  }
  if (!host) return Response.json({ meta: null });

  return Response.json({ meta: await readMeta(siteKey(host)) });
}
