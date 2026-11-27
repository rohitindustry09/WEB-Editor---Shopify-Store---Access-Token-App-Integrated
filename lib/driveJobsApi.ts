import type { DriveJobSnapshot } from "./driveJobTypes";
import type { RemoteZipSource } from "./skuMediaZip";

/** Browser-side calls to the server's Google Drive download jobs. A failure throws an Error carrying the server's own message. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || body === null) throw new Error(body?.error ?? `The server answered ${response.status}.`);
  return body;
}

export const driveJobs = {
  list: async (): Promise<DriveJobSnapshot[]> => (await call<{ jobs: DriveJobSnapshot[] }>("/api/gdrive/jobs")).jobs,
  start: async (url: string): Promise<DriveJobSnapshot> => (await call<{ job: DriveJobSnapshot }>("/api/gdrive/jobs", { method: "POST", body: JSON.stringify({ url }) })).job,
  pause: async (id: string): Promise<DriveJobSnapshot> =>
    (await call<{ job: DriveJobSnapshot }>(`/api/gdrive/jobs/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ action: "pause" }) })).job,
  discard: async (id: string): Promise<void> => {
    await call<{ ok: boolean }>(`/api/gdrive/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

/** A finished download as something the zip reader can open: the server's saved copy, read piece by piece. */
export function remoteSourceOf(job: DriveJobSnapshot): RemoteZipSource {
  return { kind: "remote", url: `/api/gdrive/file/${encodeURIComponent(job.id)}`, size: job.total ?? job.received, name: job.name ?? "drive-download.zip" };
}
