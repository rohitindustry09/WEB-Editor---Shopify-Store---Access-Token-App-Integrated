"use client";

import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Tabs,
  TextField,
  Box,
  InlineGrid,
  Thumbnail,
  Text,
  BlockStack,
  Spinner,
  Banner,
  InlineStack,
} from "@shopify/polaris";

export interface PickedImage {
  id: string;
  url: string;
  altText: string | null;
}

interface StoreFile {
  id: string;
  alt: string | null;
  url: string | null;
}

interface MediaPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (images: PickedImage[]) => void;
  allowMultiple?: boolean;
}

export function MediaPicker({ open, onClose, onSelect, allowMultiple = true }: MediaPickerProps) {
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<StoreFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // Debounced fetch of an external resource (the store's file list) keyed
    // on the modal being open / the search query — not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/files?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data.ok) setFiles(data.files);
        else setError(data.error);
      } catch {
        setError("Couldn't load your store's files.");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [open, query, tab]);

  useEffect(() => {
    // Reset local selection state when the modal closes — synchronizing
    // with the `open` prop from the parent, not deriving from other state.
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(new Set());
      setQuery("");
      setTab(0);
    }
  }, [open]);

  const toggle = (fileId: string) => {
    setSelected((prev) => {
      if (!allowMultiple) return prev.has(fileId) ? new Set() : new Set([fileId]);
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const confirm = () => {
    const images = files
      .filter((f) => f.url && selected.has(f.id))
      .map((f) => ({ id: f.id, url: f.url!, altText: f.alt }));
    onSelect(images);
    onClose();
  };

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(fileList)) {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/files/upload", { method: "POST", body });
        const data = await res.json();
        if (!data.ok) {
          setError(data.error ?? "Upload failed.");
          continue;
        }
        if (data.file?.url) {
          setFiles((prev) => [{ id: data.file.id, alt: data.file.alt, url: data.file.url }, ...prev]);
          setSelected((prev) => new Set([...prev, data.file.id]));
        } else {
          setError("Uploaded — Shopify is still processing this image. Reopen this picker in a moment to select it.");
        }
      }
      setTab(0);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add media"
      primaryAction={{ content: "Add selected", onAction: confirm, disabled: selected.size === 0 }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
      size="large"
    >
      <Tabs
        tabs={[{ id: "existing", content: "Select existing" }, { id: "upload", content: "Upload new" }]}
        selected={tab}
        onSelect={setTab}
      />
      <Modal.Section>
        {error && (
          <Box paddingBlockEnd="300">
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Box>
        )}

        {tab === 0 && (
          <BlockStack gap="300">
            <TextField
              label="Search files"
              labelHidden
              autoComplete="off"
              placeholder="Search your store's files…"
              value={query}
              onChange={setQuery}
              clearButton
              onClearButtonClick={() => setQuery("")}
            />
            {loading ? (
              <Box padding="800">
                <InlineStack align="center"><Spinner size="small" /></InlineStack>
              </Box>
            ) : files.length === 0 ? (
              <Text as="p" tone="subdued" alignment="center">No images found.</Text>
            ) : (
              <InlineGrid columns={{ xs: 3, sm: 4, md: 5 }} gap="200">
                {files.map((f) => {
                  const isSelected = selected.has(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => f.url && toggle(f.id)}
                      disabled={!f.url}
                      style={{
                        border: isSelected ? "2px solid var(--p-color-border-emphasis)" : "2px solid transparent",
                        borderRadius: 8,
                        padding: 2,
                        background: "var(--p-color-bg-surface-secondary)",
                        cursor: f.url ? "pointer" : "not-allowed",
                        aspectRatio: "1",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {f.url ? (
                        <Thumbnail source={f.url} alt={f.alt ?? ""} size="large" />
                      ) : (
                        <Text as="span" variant="bodySm" tone="subdued">Processing…</Text>
                      )}
                    </button>
                  );
                })}
              </InlineGrid>
            )}
          </BlockStack>
        )}

        {tab === 1 && (
          <BlockStack gap="300">
            <Box
              padding="800"
              background="bg-surface-secondary"
              borderRadius="200"
              borderWidth="025"
              borderStyle="dashed"
              borderColor="border"
            >
              <BlockStack gap="300" align="center" inlineAlign="center">
                <Text as="p" tone="subdued">Upload images from your computer</Text>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple={allowMultiple}
                  onChange={(e) => handleUpload(e.target.files)}
                  disabled={uploading}
                />
                {uploading && <Spinner size="small" />}
              </BlockStack>
            </Box>
          </BlockStack>
        )}
      </Modal.Section>
    </Modal>
  );
}
