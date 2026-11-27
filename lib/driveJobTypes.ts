/** What the browser sees of a server-side Google Drive download. Shared by the server job code and the page that shows it. */

export type DriveJobStatus =
  /** Asking Drive for the file's name and size. */
  | "starting"
  | "downloading"
  /** Stopped (by the user, or the server restarted) with the pieces so far kept on disk — it can be resumed. */
  | "paused"
  /** Fully saved on the server and ready to open. */
  | "done"
  | "error";

export interface DriveJobSnapshot {
  /** The Drive file ID — also names the saved copy on the server. */
  id: string;
  /** The link as pasted, so a stopped download can be resumed from it. */
  url: string;
  name: string | null;
  total: number | null;
  received: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  /** Pieces being fetched from Drive at this moment. */
  connections: number;
  status: DriveJobStatus;
  error: string | null;
  /** Bytes that were already on disk from an earlier run and didn't need fetching again. */
  resumedBytes: number;
  updatedAt: number;
}
