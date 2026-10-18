import { redirect, notFound } from "next/navigation";
import { getAuthenticatedStore } from "@/lib/auth/session";
import { getJob } from "@/lib/storeScraper/store";
import { FlaggedPreviewGrid } from "./FlaggedPreviewGrid";

/**
 * Deliberately OUTSIDE the `(app)` route group — that group's layout wraps
 * every page in the full dashboard chrome (`AppFrame`: sidebar, top bar,
 * nav). This is a bare, single-purpose page: just the live flagged-images
 * grid, nothing else, per the explicit ask for "no dashboard and things."
 * Still auth-gated the same way `(app)/layout.tsx` gates everything else —
 * skipping the shared layout doesn't mean skipping the session check.
 */
export default async function StoreScraperPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const store = await getAuthenticatedStore();
  if (!store) redirect("/connect");

  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();

  return <FlaggedPreviewGrid jobId={id} hostname={safeHostname(job.options.inputUrl)} />;
}

function safeHostname(inputUrl: string): string {
  try {
    return new URL(inputUrl).hostname;
  } catch {
    return "store";
  }
}
