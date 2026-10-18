"use client";

import { useState } from "react";

type Props = {
  beforeUrl: string;
  afterUrl: string | null;
  loading?: boolean;
};

/**
 * A drag-to-reveal comparison instead of two side-by-side cards — drag the
 * handle (or the slider input under it, for keyboard/touch access) to wipe
 * between the original and the edited result at the same spot in the frame,
 * which makes a subtle change (a slightly different backdrop shade, a small
 * zoom adjustment) far easier to actually see than eyeballing two separate
 * boxes. Presentational only — no eyedropper here, since half the "before"
 * image is normally hidden behind the reveal; `BgCustomiserForm.tsx` keeps
 * the original side-by-side layout (with its working eyedropper) as the
 * default and offers this as an opt-in "Compare" view.
 */
export function BeforeAfterSlider({ beforeUrl, afterUrl, loading }: Props) {
  const [position, setPosition] = useState(50);

  return (
    <div style={{ width: "100%", maxWidth: 420 }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1",
          borderRadius: 8,
          overflow: "hidden",
          background: "repeating-conic-gradient(#e3e3e3 0% 25%, #f4f4f4 0% 50%) 50% / 16px 16px",
          border: "1px solid var(--p-color-border)",
          userSelect: "none",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- transient client-only object URL */}
        <img src={beforeUrl} alt="Original" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
        {afterUrl && (
          <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${100 - position}% 0 0)` }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- transient client-only object URL */}
            <img src={afterUrl} alt="Edited" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
        )}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${position}%`,
            width: 2,
            marginLeft: -1,
            background: "#fff",
            boxShadow: "0 0 4px rgba(0,0,0,0.4)",
            pointerEvents: "none",
          }}
        />
        {loading && (
          <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(255,255,255,0.85)", borderRadius: 6, padding: "2px 8px", fontSize: 12 }}>
            Updating…
          </div>
        )}
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={position}
        onChange={(e) => setPosition(Number(e.target.value))}
        aria-label="Reveal position"
        style={{ width: "100%", marginTop: 8 }}
      />
    </div>
  );
}
