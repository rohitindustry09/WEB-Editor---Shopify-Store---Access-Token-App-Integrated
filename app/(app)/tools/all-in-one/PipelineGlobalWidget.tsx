"use client";

import { useSyncExternalStore } from "react";
import { Modal, Text, ProgressBar, Icon, Spinner } from "@shopify/polaris";
import { XIcon, MagicIcon, CheckCircleIcon, AlertCircleIcon } from "@shopify/polaris-icons";
import { pipelineRunStore, STAGE_LABEL } from "./pipelineRunStore";
import { PipelineProgressPanel } from "./PipelineProgressPanel";

/**
 * Mounted exactly once, inside `AppFrame` — so it stays alive across every
 * route change in the app (only `AppFrame`'s own `children` swap between
 * pages, `AppFrame` itself never unmounts). That's what makes a pipeline
 * run started on `/tools/all-in-one` still visible — and cancellable —
 * after navigating away to look at something else, and still visible again
 * after closing the popup: closing it just flips `popupOpen` back to
 * `false` on the shared store, which collapses this into the fixed
 * bottom-right pill instead of unmounting anything the run depends on.
 */
export function PipelineGlobalWidget() {
  const state = useSyncExternalStore(pipelineRunStore.subscribe, pipelineRunStore.getSnapshot, pipelineRunStore.getSnapshot);

  if (state.stage === "idle") return null;

  const running = pipelineRunStore.isRunning();
  const percent = state.stageProgress && state.stageProgress.total > 0 ? Math.round((state.stageProgress.done / state.stageProgress.total) * 100) : null;

  const handleCancel = () => pipelineRunStore.cancel();
  const handleDismiss = () => pipelineRunStore.reset();

  if (state.popupOpen) {
    return (
      <Modal open title="All-in-one pipeline" onClose={() => pipelineRunStore.setPopupOpen(false)}>
        <Modal.Section>
          <PipelineProgressPanel state={state} running={running} onCancel={handleCancel} onDismiss={handleDismiss} />
        </Modal.Section>
      </Modal>
    );
  }

  const icon = state.stage === "done" ? CheckCircleIcon : state.stage === "error" ? AlertCircleIcon : null;
  const tone = state.stage === "done" ? "success" : state.stage === "error" ? "critical" : "base";

  return (
    <button
      type="button"
      onClick={() => pipelineRunStore.setPopupOpen(true)}
      aria-label="Show pipeline progress"
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        zIndex: 1200,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 999,
        border: "1px solid var(--p-color-border, #d1d1d1)",
        background: "var(--p-color-bg-surface, #fff)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.16)",
        cursor: "pointer",
        maxWidth: 300,
      }}
    >
      {running ? (
        <Spinner size="small" />
      ) : (
        <Icon source={icon ?? MagicIcon} tone={tone === "critical" ? "critical" : tone === "success" ? "success" : "subdued"} />
      )}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0 }}>
        <Text as="span" variant="bodySm" fontWeight="medium" truncate>
          {STAGE_LABEL[state.stage] || "All-in-one pipeline"}
        </Text>
        {percent !== null && running && (
          <div style={{ width: 160, marginTop: 4 }}>
            <ProgressBar progress={percent} size="small" tone="primary" />
          </div>
        )}
      </div>
      {percent !== null && running && (
        <Text as="span" variant="bodySm" tone="subdued">{`${percent}%`}</Text>
      )}
      {!running && (
        <span
          role="button"
          tabIndex={0}
          aria-label="Dismiss"
          onClick={(e) => {
            e.stopPropagation();
            handleDismiss();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              handleDismiss();
            }
          }}
          style={{ display: "flex", marginLeft: 4 }}
        >
          <Icon source={XIcon} tone="subdued" />
        </span>
      )}
    </button>
  );
}
