import type { StagedUploadTarget } from "@/lib/shopify/media";
import type { ZipImageFile } from "@/lib/skuMediaZip";

/**
 * POSTs a file's bytes directly from the browser to a Shopify staged-upload
 * target (a signed, CORS-enabled bucket URL) — the standard flow for
 * `stagedUploadsCreate`: every `parameters` entry goes into the form first,
 * the file itself goes last.
 */
export async function uploadToStagedTarget(target: StagedUploadTarget, file: ZipImageFile, signal?: AbortSignal): Promise<void> {
  const formData = new FormData();
  for (const param of target.parameters) {
    formData.append(param.name, param.value);
  }
  formData.append("file", file.blob, file.filename);

  const response = await fetch(target.url, { method: "POST", body: formData, signal });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Upload failed for "${file.filename}" (${response.status}): ${body.slice(0, 300) || response.statusText}`);
  }
}
