"use client";

import { useRef, useState } from "react";
import { Banner, BlockStack, Button, InlineStack, ProgressBar, Text, TextField } from "@shopify/polaris";
import { formatFileSize } from "@/lib/csvSkuColors";
import { parseDriveLink } from "@/lib/googleDrive";

/** Reads a response body chunk by chunk so progress can be shown, then returns it as one file. */
async function readAsFile(response: Response, onProgress: (received: number, total: number | null) => void): Promise<File> {
  const total = Number(response.headers.get("content-length")) || null;
  const rawName = response.headers.get("x-drive-filename");
  let name = "drive-download.zip";
  try {
    if (rawName) name = decodeURIComponent(rawName);
  } catch {
    // Keep the default name.
  }
  if (!/\.zip$/i.test(name)) name = `${name}.zip`;

  const reader = response.body?.getReader();
  if (!reader) throw new Error("The download didn't start.");
  const parts: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value as BlobPart);
    received += value.byteLength;
    onProgress(received, total);
  }
  return new File(parts, name, { type: "application/zip" });
}

/**
 * "Or paste a Google Drive link": downloads a public Drive zip through the server and hands it to the page exactly like a
 * file dropped from the computer. The file must be shared as "Anyone with the link".
 */
export function DriveLinkImport({ onFile, disabled }: { onFile: (file: File) => void; disabled?: boolean }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ received: number; total: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = async () => {
    const link = parseDriveLink(url);
    if (link.kind === "folder") return setError("That's a folder link. Zip the folder first, then share the zip file.");
    if (link.kind !== "file") return setError("That doesn't look like a Google Drive file link, e.g. https://drive.google.com/file/d/…/view");

    setError(null);
    setBusy(true);
    setProgress({ received: 0, total: null });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/gdrive/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `The server answered ${response.status}.`);
      }
      const file = await readAsFile(response, (received, total) => setProgress({ received, total }));
      setUrl("");
      onFile(file);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "The download failed.");
    } finally {
      abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <BlockStack gap="200">
      <Text as="p" variant="bodySm" tone="subdued">
        Or add it from Google Drive — paste the file&apos;s share link (it must be shared as &ldquo;Anyone with the link&rdquo;).
      </Text>
      <InlineStack gap="200" blockAlign="end" wrap={false}>
        <div style={{ flex: 1 }}>
          <TextField
            label="Google Drive link"
            labelHidden
            placeholder="https://drive.google.com/file/d/…/view?usp=sharing"
            value={url}
            onChange={setUrl}
            autoComplete="off"
            disabled={busy || disabled}
            clearButton
            onClearButtonClick={() => setUrl("")}
          />
        </div>
        {busy ? (
          <Button tone="critical" onClick={() => abortRef.current?.abort()}>Cancel</Button>
        ) : (
          <Button variant="primary" disabled={disabled || url.trim() === ""} onClick={() => void start()}>Add from Drive</Button>
        )}
      </InlineStack>
      {busy && progress && (
        <BlockStack gap="100">
          <ProgressBar progress={progress.total ? (progress.received / progress.total) * 100 : 0} size="small" />
          <Text as="span" variant="bodySm" tone="subdued">
            Downloading from Drive… {formatFileSize(progress.received)}
            {progress.total ? ` of ${formatFileSize(progress.total)}` : ""}
          </Text>
        </BlockStack>
      )}
      {error && <Banner tone="warning" onDismiss={() => setError(null)}><p>{error}</p></Banner>}
    </BlockStack>
  );
}
