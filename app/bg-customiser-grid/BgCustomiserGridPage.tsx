"use client";
/* eslint-disable react-hooks/set-state-in-effect -- reading `window.opener` after mount, so SSR and the first client render match before swapping in the live bridge (same pattern as MediaUploadForm.tsx's localStorage read) */

import { useEffect, useState } from "react";
import { Text, Spinner } from "@shopify/polaris";
import { BgFolderGridView } from "@/app/(app)/tools/bg-customiser/BgFolderGridView";
import { readGridBridgeFromOpener, type BgCustomiserGridBridge } from "@/app/(app)/tools/bg-customiser/gridBridge";

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      {children}
    </div>
  );
}

/**
 * `undefined` while still checking `window.opener` on the very first render,
 * `null` once checked and there genuinely isn't one — kept distinct so the
 * page doesn't flash "can't find the zip" for the one tick before the check
 * has actually run.
 */
export function BgCustomiserGridPage() {
  const [bridge, setBridge] = useState<BgCustomiserGridBridge | null | undefined>(undefined);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  useEffect(() => {
    const found = readGridBridgeFromOpener();
    setBridge(found);
    if (!found) return;
    setSelectedPaths(found.getSelectedPaths());
    return found.subscribe(setSelectedPaths);
  }, []);

  if (bridge === undefined) {
    return (
      <CenteredMessage>
        <Spinner size="large" />
      </CenteredMessage>
    );
  }

  if (!bridge) {
    return (
      <CenteredMessage>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <Text as="p" tone="subdued">
            Can&apos;t find the zip this grid needs. Open this from the &quot;View in grid&quot; button in Background
            Customiser instead of this tab&apos;s own address bar — and keep that original tab open, since this one
            reads its zip directly from there.
          </Text>
        </div>
      </CenteredMessage>
    );
  }

  return (
    <BgFolderGridView
      zip={bridge.zip}
      folders={bridge.folders}
      effectiveSelectedPaths={selectedPaths}
      onPick={bridge.onPick}
      onClose={() => window.close()}
    />
  );
}
