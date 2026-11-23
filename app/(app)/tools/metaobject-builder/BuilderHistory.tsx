"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Banner, BlockStack, Box, Button, Card, IndexTable, InlineStack, Modal, Text } from "@shopify/polaris";
import type { ActivityEntry, SavedFile } from "@/lib/metaobjectBuilderStore";
import { deleteActivityAction, deleteSavedFileAction, loadBuilderStateAction, previewRevertAction, readSavedFileAction, revertActivityAction } from "./actions";

const formatWhen = (iso: string): string => new Date(iso).toLocaleString();
const formatSize = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

interface RevertPlan {
  entry: ActivityEntry;
  entries: { type: string; count: number }[];
  deletable: number;
}

/**
 * The bottom of the builder: every file you uploaded (kept on the server, so you can download it or attach it
 * again) and the recent runs, each with Revert (deletes what that run created, fields included), Run again
 * (puts its file and settings back on the page) and Delete (forgets the log entry).
 */
export function BuilderHistory({
  refreshKey,
  disabled,
  onUseFile,
  onRunAgain,
}: {
  /** Bump to reload the lists after a file was saved or a run was logged. */
  refreshKey: number;
  disabled: boolean;
  onUseFile: (file: { id: string; name: string; kind: SavedFile["kind"]; content: string }) => void;
  onRunAgain: (entry: ActivityEntry) => void;
}) {
  const [files, setFiles] = useState<SavedFile[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revertPlan, setRevertPlan] = useState<RevertPlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await loadBuilderStateAction().catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
    if (response.ok) {
      setFiles(response.files);
      setActivity(response.activity);
      setError(null);
    } else {
      setFiles([]);
      setActivity([]);
      setError(response.error);
    }
  }, []);

  useEffect(() => {
    // Loads the saved lists on first show and whenever the page logs something new.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh, refreshKey]);

  const attachFile = async (file: SavedFile) => {
    setBusy(file.id);
    const response = await readSavedFileAction(file.id);
    setBusy(null);
    if (!response.ok) return setMessage(response.error);
    onUseFile({ id: file.id, name: file.name, kind: file.kind, content: response.content });
    setMessage(`${file.name} is attached again — it's loaded into the form above.`);
  };

  const download = async (file: SavedFile) => {
    setBusy(file.id);
    const response = await readSavedFileAction(file.id);
    setBusy(null);
    if (!response.ok) return setMessage(response.error);
    const blob = new Blob(["﻿" + response.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const removeFile = async (file: SavedFile) => {
    await deleteSavedFileAction(file.id);
    await refresh();
  };

  const startRevert = async (entry: ActivityEntry) => {
    setBusy(entry.id);
    const response = await previewRevertAction(entry.id).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
    setBusy(null);
    if (!response.ok) return setMessage(response.error);
    setRevertPlan({ entry, entries: response.entries, deletable: response.deletable });
  };

  const confirmRevert = async () => {
    if (!revertPlan) return;
    const { entry } = revertPlan;
    setRevertPlan(null);
    setBusy(entry.id);
    const response = await revertActivityAction(entry.id).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
    setBusy(null);
    if (!response.ok) setMessage(response.error);
    else setMessage(response.failed.length === 0 ? `Reverted: ${response.deleted} ${response.deleted === 1 ? "item" : "items"} deleted from your store.` : `Reverted ${response.deleted}, but some couldn't be deleted: ${response.failed[0]}`);
    await refresh();
  };

  const removeEntry = async (entry: ActivityEntry) => {
    await deleteActivityAction(entry.id);
    await refresh();
  };

  const createdCount = (entry: ActivityEntry) => entry.objects.filter((o) => o.created).length + entry.metafields.filter((m) => m.created).length;
  const entriesAtRisk = revertPlan?.entries.reduce((sum, item) => sum + item.count, 0) ?? 0;

  return (
    <BlockStack gap="400">
      {error && <Banner tone="warning"><p>{error}</p></Banner>}
      {message && <Banner tone="info" onDismiss={() => setMessage(null)}><p>{message}</p></Banner>}

      <Card padding="0">
        <Box padding="400"><Text as="h2" variant="headingMd">Saved files</Text><Text as="p" tone="subdued">Every file you add is kept on the server. Download it, or attach it again to run it with the same fields.</Text></Box>
        {files === null || files.length === 0 ? (
          <Box padding="400" paddingBlockStart="0"><Text as="p" tone="subdued">{files === null ? "Loading…" : "No files saved yet."}</Text></Box>
        ) : (
          <IndexTable resourceName={{ singular: "file", plural: "files" }} itemCount={files.length} selectable={false} headings={[{ title: "File" }, { title: "Type" }, { title: "Size" }, { title: "Saved" }, { title: "" }]}>
            {files.map((file, index) => (
              <IndexTable.Row id={file.id} key={file.id} position={index}>
                <IndexTable.Cell><Text as="span" fontWeight="semibold" truncate>{file.name}</Text></IndexTable.Cell>
                <IndexTable.Cell><Badge>{file.kind === "csv" ? "CSV" : "Field list"}</Badge></IndexTable.Cell>
                <IndexTable.Cell>{formatSize(file.size)}</IndexTable.Cell>
                <IndexTable.Cell>{formatWhen(file.createdAt)}</IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack gap="200" wrap={false}>
                    <Button size="slim" onClick={() => void attachFile(file)} disabled={disabled || busy === file.id}>Attach again</Button>
                    <Button size="slim" onClick={() => void download(file)} disabled={busy === file.id}>Download</Button>
                    <Button size="slim" variant="tertiary" tone="critical" onClick={() => void removeFile(file)} disabled={busy === file.id}>Delete</Button>
                  </InlineStack>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}
      </Card>

      <Card padding="0">
        <Box padding="400"><Text as="h2" variant="headingMd">Recent activity</Text><Text as="p" tone="subdued">What each run created in your store. Revert deletes those definitions and metafields completely, fields included.</Text></Box>
        {activity === null || activity.length === 0 ? (
          <Box padding="400" paddingBlockStart="0"><Text as="p" tone="subdued">{activity === null ? "Loading…" : "Nothing has been created yet."}</Text></Box>
        ) : (
          <IndexTable resourceName={{ singular: "run", plural: "runs" }} itemCount={activity.length} selectable={false} headings={[{ title: "When" }, { title: "What was created" }, { title: "Result" }, { title: "Status" }, { title: "" }]}>
            {activity.map((entry, index) => {
              const created = createdCount(entry);
              return (
                <IndexTable.Row id={entry.id} key={entry.id} position={index}>
                  <IndexTable.Cell>{formatWhen(entry.createdAt)}</IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" truncate>{entry.label}</Text></IndexTable.Cell>
                  <IndexTable.Cell>{`${entry.objects.filter((o) => o.created).length} new / ${entry.objects.length} definitions · ${entry.metafields.filter((m) => m.created).length} new / ${entry.metafields.length} metafields`}</IndexTable.Cell>
                  <IndexTable.Cell>{entry.revertedAt ? <Badge tone="info">{`Reverted ${formatWhen(entry.revertedAt)}`}</Badge> : created === 0 ? <Badge>Nothing new</Badge> : <Badge tone="success">Applied</Badge>}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="200" wrap={false}>
                      <Button size="slim" tone="critical" onClick={() => void startRevert(entry)} disabled={disabled || busy === entry.id || created === 0 || entry.revertedAt !== null}>Revert</Button>
                      <Button size="slim" onClick={() => onRunAgain(entry)} disabled={disabled}>Run again</Button>
                      <Button size="slim" variant="tertiary" tone="critical" onClick={() => void removeEntry(entry)} disabled={busy === entry.id}>Delete</Button>
                    </InlineStack>
                  </IndexTable.Cell>
                </IndexTable.Row>
              );
            })}
          </IndexTable>
        )}
      </Card>

      <Modal
        open={revertPlan !== null}
        onClose={() => setRevertPlan(null)}
        title="Revert this run?"
        primaryAction={{ content: "Delete from my store", destructive: true, onAction: () => void confirmRevert() }}
        secondaryActions={[{ content: "Cancel", onAction: () => setRevertPlan(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">{revertPlan ? `${revertPlan.deletable} ${revertPlan.deletable === 1 ? "item" : "items"} created by "${revertPlan.entry.label}" will be deleted from your store, with all their fields.` : ""}</Text>
            {entriesAtRisk > 0 && (
              <Banner tone="critical">
                <p>{`These definitions already hold ${entriesAtRisk} metaobject ${entriesAtRisk === 1 ? "entry" : "entries"} (${revertPlan?.entries.filter((item) => item.count > 0).map((item) => `${item.type}: ${item.count}`).join(", ")}). Deleting a definition deletes its entries too, and that can't be undone.`}</p>
              </Banner>
            )}
            <Text as="p" tone="subdued">Definitions that already existed before this run were only reused, so they are left alone.</Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}
