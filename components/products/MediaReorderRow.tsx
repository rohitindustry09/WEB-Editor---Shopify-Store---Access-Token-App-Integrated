"use client";

import { memo, useState } from "react";
import { Text } from "@shopify/polaris";
import type { ImageProcessStep } from "./MediaImageGrid";

export type MediaOrderItem =
  | { kind: "existing"; mediaId: string; url: string }
  | { kind: "new"; key: string; sku: string; filename: string; url: string };

const THUMB_SIZE = 76;
const EXISTING_COLOR = "#008060"; // Shopify green
const NEW_COLOR = "#2c6ecb"; // Shopify blue

function itemKey(item: MediaOrderItem): string {
  return item.kind === "existing" ? `existing:${item.mediaId}` : `new:${item.key}`;
}

function StepBadge({ step }: { step: ImageProcessStep }) {
  if (!step || step === "idle") return null;
  if (step === "done") {
    return (
      <div style={dotStyle("#006041")}>
        <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>✓</span>
      </div>
    );
  }
  if (step === "error") {
    return (
      <div style={dotStyle("#8e1d1d")}>
        <span style={{ color: "#fff", fontSize: 12, fontWeight: 700, lineHeight: 1 }}>!</span>
      </div>
    );
  }
  // checking / converting / uploading
  return (
    <div style={dotStyle("rgba(0,0,0,0.55)")}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          border: "2px solid rgba(255,255,255,0.35)",
          borderTopColor: "#fff",
          display: "inline-block",
          animation: "media-reorder-spin 0.8s linear infinite",
        }}
      />
    </div>
  );
}

function dotStyle(background: string): React.CSSProperties {
  return {
    position: "absolute",
    top: 3,
    right: 3,
    width: 18,
    height: 18,
    borderRadius: "50%",
    background,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

interface Props {
  items: MediaOrderItem[];
  onReorder: (next: MediaOrderItem[]) => void;
  status?: Record<string, ImageProcessStep>;
  disabled?: boolean;
}

/**
 * A single draggable row mixing a product's existing images (green border)
 * with the new images queued for it (blue border) — dragging any thumbnail
 * moves it anywhere in the sequence, existing and new alike, and that final
 * order is what gets sent to Shopify's media reorder call before upload.
 */
export const MediaReorderRow = memo(function MediaReorderRow({ items, onReorder, status, disabled }: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  if (items.length === 0) return null;

  const handleDrop = (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const next = [...items];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIndex, 0, moved);
    onReorder(next);
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
      <style>{`@keyframes media-reorder-spin { to { transform: rotate(360deg); } }`}</style>
      {items.map((item, index) => {
        const step = item.kind === "new" ? status?.[item.filename] : undefined;
        const isDragging = dragIndex === index;
        const isOver = overIndex === index && dragIndex !== null && dragIndex !== index;
        return (
          <div
            key={itemKey(item)}
            draggable={!disabled}
            onDragStart={() => setDragIndex(index)}
            onDragEnter={() => setOverIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(index)}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            style={{
              position: "relative",
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              flexShrink: 0,
              borderRadius: 8,
              overflow: "hidden",
              border: `3px solid ${item.kind === "existing" ? EXISTING_COLOR : NEW_COLOR}`,
              opacity: isDragging ? 0.4 : 1,
              outline: isOver ? "2px dashed var(--p-color-border-emphasis)" : "none",
              outlineOffset: 2,
              cursor: disabled ? "default" : "grab",
              background: "var(--p-color-bg-surface-secondary)",
            }}
          >
            {item.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- blob: object URLs and Shopify CDN URLs both need a plain img here
              <img
                src={item.url}
                alt={item.kind === "existing" ? "Existing product image" : item.filename}
                draggable={false}
                style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--p-color-text-secondary)",
                }}
                title={item.kind === "new" ? item.filename : undefined}
              >
                <Text as="span" variant="bodyXs">…</Text>
              </div>
            )}
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                padding: "1px 4px",
                background: "rgba(0,0,0,0.55)",
                textAlign: "center",
              }}
            >
              <Text as="span" variant="bodyXs">
                <span style={{ color: "#fff" }}>{index + 1}</span>
              </Text>
            </div>
            {step && <StepBadge step={step} />}
          </div>
        );
      })}
    </div>
  );
});
