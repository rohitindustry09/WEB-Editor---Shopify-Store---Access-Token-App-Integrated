"use client";

import { useState } from "react";
import { Modal, Box, Text, Spinner } from "@shopify/polaris";

export type ImageProcessStep = "idle" | "checking" | "converting" | "uploading" | "done" | "error";

export interface MediaImageGridItem {
  url: string;
  filename: string;
  step?: ImageProcessStep;
}

const THUMB_SIZE = 72;

const STEP_LABEL: Record<ImageProcessStep, string> = {
  idle: "",
  checking: "Checking",
  converting: "Converting",
  uploading: "Uploading",
  done: "Done",
  error: "Error",
};

function StepOverlay({ step }: { step: ImageProcessStep }) {
  if (step === "idle") return null;
  if (step === "checking" || step === "converting" || step === "uploading") {
    return (
      <div style={overlayStyle("rgba(0,0,0,0.45)")}>
        <Spinner size="small" accessibilityLabel={STEP_LABEL[step]} />
      </div>
    );
  }
  if (step === "done") {
    return (
      <div style={{ ...overlayStyle("rgba(0,96,64,0.55)"), fontSize: 22, color: "#fff" }}>✓</div>
    );
  }
  if (step === "error") {
    return (
      <div style={{ ...overlayStyle("rgba(142,29,29,0.6)"), fontSize: 18, color: "#fff", fontWeight: 700 }}>!</div>
    );
  }
  return null;
}

function overlayStyle(background: string): React.CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    background,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  };
}

/** Wrapping grid of the images queued for one SKU — wraps to new rows instead of scrolling, shows a live processing step per thumbnail, and every thumbnail opens a larger preview. */
export function MediaImageGrid({ images }: { images: MediaImageGridItem[] }) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  if (images.length === 0) return null;

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {images.map((img, i) => (
          <div key={img.url} style={{ position: "relative", flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setPreviewIndex(i)}
              aria-label={`Preview ${img.filename}`}
              style={{
                width: THUMB_SIZE,
                height: THUMB_SIZE,
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid var(--p-color-border)",
                padding: 0,
                cursor: "pointer",
                background: "var(--p-color-bg-surface-secondary)",
                display: "block",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- blob: object URLs aren't supported by next/image */}
              <img src={img.url} alt={img.filename} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </button>
            {img.step && <StepOverlay step={img.step} />}
          </div>
        ))}
      </div>

      <Modal
        open={previewIndex !== null}
        onClose={() => setPreviewIndex(null)}
        title={previewIndex !== null ? images[previewIndex].filename : ""}
      >
        <Modal.Section>
          {previewIndex !== null && (
            <Box>
              {/* eslint-disable-next-line @next/next/no-img-element -- blob: object URLs aren't supported by next/image */}
              <img
                src={images[previewIndex].url}
                alt={images[previewIndex].filename}
                style={{ width: "100%", borderRadius: 8, display: "block" }}
              />
              <Box paddingBlockStart="200">
                <Text as="p" tone="subdued" variant="bodySm">
                  {previewIndex + 1} of {images.length}
                </Text>
              </Box>
            </Box>
          )}
        </Modal.Section>
      </Modal>
    </>
  );
}
