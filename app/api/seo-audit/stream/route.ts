import { guardApi } from "@/lib/auth/apiGuard";
import { runStreamingAudit, InvalidDomainError, type AuditEvent } from "@/lib/seoAudit/runAudit";
import { DEFAULT_MAX_PAGES, MAX_PAGES_LIMIT, MAX_PAGES_OPTIONS } from "@/lib/seoAudit/crawler";

export const dynamic = "force-dynamic";

/**
 * Streams the audit's progress as newline-delimited JSON (`AuditEvent`
 * values, one per line) while it runs, finishing with either a `{type:
 * "done", report}` or a `{type: "fatal-error", message}` line. A server
 * action can't do this — it only ever resolves once, with one final value
 * — so this tool's real-time crawl feed needs a real streamed HTTP
 * response instead, read on the client via `response.body.getReader()`.
 */
export async function POST(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;
  let payload: { domain?: unknown; maxPages?: unknown };
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ type: "fatal-error", message: "Invalid request body." }) + "\n", { status: 400 });
  }

  const domain = typeof payload.domain === "string" ? payload.domain : "";
  const requestedMaxPages = typeof payload.maxPages === "number" ? payload.maxPages : DEFAULT_MAX_PAGES;
  const maxPages = MAX_PAGES_OPTIONS.includes(requestedMaxPages as (typeof MAX_PAGES_OPTIONS)[number])
    ? requestedMaxPages
    : Math.max(1, Math.min(requestedMaxPages, MAX_PAGES_LIMIT));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AuditEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        const report = await runStreamingAudit(domain, emit, maxPages);
        controller.enqueue(encoder.encode(JSON.stringify({ type: "done", report }) + "\n"));
      } catch (err) {
        const message = err instanceof InvalidDomainError || err instanceof Error ? err.message : "Couldn't run the audit.";
        controller.enqueue(encoder.encode(JSON.stringify({ type: "fatal-error", message }) + "\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
