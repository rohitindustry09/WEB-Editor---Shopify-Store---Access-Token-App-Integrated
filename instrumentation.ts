/**
 * Runs once when the server starts. Background customiser runs that were still going (or waiting) when the server last
 * stopped carry on from their saved progress — no browser has to be open for that.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { resumeBgJobs } = await import("./lib/bgJobs");
  await resumeBgJobs().catch(() => undefined);
}
