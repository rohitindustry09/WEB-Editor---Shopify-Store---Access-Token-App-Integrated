"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Banner, BlockStack, Box, Button, Card, IndexTable, InlineStack, Modal, Page, Spinner, Text } from "@shopify/polaris";
import { runChanges } from "@/lib/merchant/applyClient";
import { revertChanges } from "@/lib/merchant/revert";
import type { HistoryRunSummary } from "@/lib/merchant/types";
import { deleteRunAction, getRunEntriesAction, listRunsAction, markRunRevertedAction } from "../actions";

interface RevertState {
  runId: string;
  done: number;
  total: number;
  failed: number;
  message: string | null;
}

const formatWhen = (iso: string): string => new Date(iso).toLocaleString();

/**
 * Every run a Merchant Tool made, newest first, each with a one-click Revert that writes the saved "before"
 * values back. A reverted run stays listed (marked) so it is clear what has already been put back.
 */
export function ChangeHistory() {
  const [runs, setRuns] = useState<HistoryRunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<HistoryRunSummary | null>(null);
  const [reverting, setReverting] = useState<RevertState | null>(null);

  const refresh = useCallback(async () => {
    const response = await listRunsAction().catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
    if (response.ok) {
      setRuns(response.runs);
      setError(null);
    } else {
      setError(response.error);
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    // Initial load of the saved runs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const revert = async (run: HistoryRunSummary) => {
    setConfirm(null);
    setReverting({ runId: run.id, done: 0, total: run.entryCount, failed: 0, message: null });
    const loaded = await getRunEntriesAction(run.id);
    if (!loaded.ok) {
      setReverting({ runId: run.id, done: 0, total: 0, failed: 0, message: loaded.error });
      return;
    }
    const changes = revertChanges(loaded.entries);
    setReverting({ runId: run.id, done: 0, total: changes.length, failed: 0, message: null });
    const problems = { count: 0, first: null as string | null };
    await runChanges(changes, {
      onOutcomes: (outcomes) => {
        const bad = outcomes.filter((entry) => !entry.outcome.ok);
        problems.count += bad.length;
        problems.first ??= bad[0]?.outcome.error ?? null;
        setReverting((prev) => (prev ? { ...prev, done: prev.done + outcomes.length, failed: prev.failed + bad.length } : prev));
      },
    });
    if (problems.count === 0) await markRunRevertedAction(run.id);
    setReverting({
      runId: run.id,
      done: changes.length,
      total: changes.length,
      failed: problems.count,
      message: problems.count === 0 ? "Everything was put back." : `Some changes couldn't be put back: ${problems.first ?? "unknown error"}. The run stays listed so you can try again.`,
    });
    await refresh();
  };

  const remove = async (run: HistoryRunSummary) => {
    await deleteRunAction(run.id);
    await refresh();
  };

  return (
    <Page fullWidth title="Change history" subtitle="Everything the Merchant Tools changed, with the old values saved so any run can be undone.">
      <BlockStack gap="400">
        {error && <Banner tone="critical"><p>{error}</p></Banner>}
        {reverting?.message && (
          <Banner tone={reverting.failed === 0 ? "success" : "warning"} title={reverting.failed === 0 ? "Run reverted" : "Reverted with problems"} onDismiss={() => setReverting(null)}>
            <p>{reverting.message}</p>
          </Banner>
        )}
        {reverting && !reverting.message && (
          <Banner tone="info" title="Putting the old values back…">
            <p>{`${reverting.done.toLocaleString()} of ${reverting.total.toLocaleString()} steps done — keep this page open.`}</p>
          </Banner>
        )}

        <Card padding="0">
          {runs === null ? (
            <InlineStack align="center" blockAlign="center" gap="200"><Spinner size="small" /><Text as="span" tone="subdued">Loading history…</Text></InlineStack>
          ) : runs.length === 0 ? (
            <Box padding="800">
              <BlockStack gap="150" inlineAlign="center">
                <Text as="h2" variant="headingMd">No changes recorded yet</Text>
                <Text as="p" tone="subdued">When you run a Merchant Tool that changes your store, each run shows up here with a Revert button.</Text>
              </BlockStack>
            </Box>
          ) : (
            <IndexTable
              resourceName={{ singular: "run", plural: "runs" }}
              itemCount={runs.length}
              selectable={false}
              headings={[{ title: "When" }, { title: "Tool" }, { title: "What changed" }, { title: "Items" }, { title: "Status" }, { title: "" }]}
            >
              {runs.map((run, index) => (
                <IndexTable.Row id={run.id} key={run.id} position={index}>
                  <IndexTable.Cell>{formatWhen(run.createdAt)}</IndexTable.Cell>
                  <IndexTable.Cell>{run.tool}</IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" truncate>{run.label}</Text></IndexTable.Cell>
                  <IndexTable.Cell>{run.entryCount.toLocaleString()}</IndexTable.Cell>
                  <IndexTable.Cell>{run.revertedAt ? <Badge tone="info">{`Reverted ${formatWhen(run.revertedAt)}`}</Badge> : <Badge tone="success">Applied</Badge>}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="200" wrap={false}>
                      <Button size="slim" disabled={reverting !== null && !reverting.message} onClick={() => setConfirm(run)}>
                        {run.revertedAt ? "Revert again" : "Revert"}
                      </Button>
                      <Button size="slim" variant="tertiary" tone="critical" disabled={reverting !== null && !reverting.message} onClick={() => void remove(run)}>
                        Forget
                      </Button>
                    </InlineStack>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title="Revert this run?"
        primaryAction={{ content: "Revert", destructive: true, onAction: () => confirm && void revert(confirm) }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirm(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">{confirm ? `${confirm.label} — ${confirm.entryCount.toLocaleString()} items will be put back to the values they had before.` : ""}</Text>
            <Text as="p" tone="subdued">Anything edited since this run (even by hand in Shopify) is overwritten with the old value.</Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
