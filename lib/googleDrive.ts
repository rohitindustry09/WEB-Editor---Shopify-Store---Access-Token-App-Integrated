/**
 * Reading Google Drive share links. Only the file ID is ever taken from what the user types — the server then builds the
 * download address itself on Google's own host, so a pasted link can never point the server at some other address.
 */

const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com", "drive.usercontent.google.com"]);
const FILE_ID = /^[A-Za-z0-9_-]{10,128}$/;

export type DriveLink =
  | { kind: "file"; id: string }
  /** A folder link: Drive can't hand out a folder as one file, so the user has to zip it first. */
  | { kind: "folder" }
  | { kind: "invalid" };

/** "https://drive.google.com/file/d/<id>/view?usp=sharing" (and the open?id= / uc?id= forms) → the file ID. */
export function parseDriveLink(input: string): DriveLink {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { kind: "invalid" };
  }
  if (url.protocol !== "https:" || !DRIVE_HOSTS.has(url.hostname)) return { kind: "invalid" };
  if (/\/folders\//.test(url.pathname)) return { kind: "folder" };

  const fromPath = /\/file\/(?:u\/\d+\/)?d\/([^/?#]+)/.exec(url.pathname)?.[1];
  const id = fromPath ?? url.searchParams.get("id") ?? "";
  return FILE_ID.test(id) ? { kind: "file", id } : { kind: "invalid" };
}

/** The address a public Drive file downloads from. `confirm=t` skips the "can't scan for viruses" page that large files show. */
export const driveDownloadUrl = (id: string): string => `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;

/** The hidden fields of Drive's "download anyway" form, which a large file's first reply can carry instead of the file. */
export function parseConfirmForm(html: string): { action: string; params: URLSearchParams } | null {
  const form = /<form[^>]+id="download-form"[^>]*>([\s\S]*?)<\/form>/i.exec(html);
  if (!form) return null;
  const action = /action="([^"]+)"/i.exec(form[0])?.[1]?.replace(/&amp;/g, "&");
  if (!action) return null;
  const params = new URLSearchParams();
  for (const input of form[1].matchAll(/<input[^>]+>/gi)) {
    const name = /name="([^"]+)"/i.exec(input[0])?.[1];
    const value = /value="([^"]*)"/i.exec(input[0])?.[1] ?? "";
    if (name) params.set(name, value.replace(/&amp;/g, "&"));
  }
  return { action, params };
}

/** The file name Drive suggests, from a Content-Disposition header. */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      /* fall through to the plain form */
    }
  }
  return /filename="?([^";]+)"?/.exec(header)?.[1] ?? null;
}

export function isAllowedDriveHost(address: string): boolean {
  try {
    const url = new URL(address);
    return url.protocol === "https:" && DRIVE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
