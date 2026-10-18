"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Banner, BlockStack, Button, Card, IndexTable, InlineStack, Page, Pagination, Text, TextField } from "@shopify/polaris";
import { StatTile } from "@/components/ui/StatTile";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import { parseCsvRows } from "@/lib/csvParsing";
import { newRunId, runChanges, type ClientChange } from "@/lib/merchant/applyClient";
import { findProblems, planRedirects, type PlannedRedirect, type Redirect, type RedirectStatus } from "@/lib/merchant/redirects";
import { loadRedirectsPageAction } from "./actions";

const PAGE_SIZE = 50;
const SAMPLE = "/old-page,/new-page\n/summer-sale,/collections/summer\n";

const STATUS: Record<RedirectStatus, { label: string; tone: "success" | "info" | "attention" | "critical" | undefined }> = {
  ok: { label: "Will create", tone: "success" },
  flattened: { label: "Will create (shortened)", tone: "info" },
  exists: { label: "Already exists", tone: undefined },
  duplicate: { label: "Repeated", tone: undefined },
  self: { label: "Points at itself", tone: "attention" },
  loop: { label: "Loop", tone: "critical" },
  invalid: { label: "Invalid", tone: "critical" },
};

/** CSV or pasted text → from/to pairs; a header row (from,to / path,target…) is skipped. */
function parseRows(text: string): { from: string; to: string }[] {
  const lines = parseCsvRows(text).filter((cells) => cells.some((cell) => cell.trim()));
  const first = lines[0];
  const hasHeader = first !== undefined && /^(from|path|old|source|url)/i.test((first[0] ?? "").trim()) && /^(to|target|new|dest)/i.test((first[1] ?? "").trim());
  return (hasHeader ? lines.slice(1) : lines).map((cells) => ({ from: cells[0] ?? "", to: cells[1] ?? "" }));
}

export function RedirectManager() {
  const [existing, setExisting] = useState<Redirect[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<RedirectStatus | "all">("all");
  const [running, setRunning] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{ created: number; failed: number; error: string | null } | null>(null);

  const loadExisting = async () => {
    setLoading(true);
    setError(null);
    let cursor: string | null = null;
    let all: Redirect[] = [];
    do {
      const response: Awaited<ReturnType<typeof loadRedirectsPageAction>> = await loadRedirectsPageAction(cursor).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
      if (!response.ok) {
        setError(response.error);
        setLoading(false);
        return;
      }
      all = all.concat(response.redirects);
      cursor = response.nextCursor;
      setExisting(all);
    } while (cursor);
    setLoading(false);
  };

  const problems = useMemo(() => (existing ? findProblems(existing) : null), [existing]);
  const planned = useMemo<PlannedRedirect[]>(() => (text.trim() && existing ? planRedirects(parseRows(text), existing) : []), [text, existing]);
  const counts = useMemo(() => {
    const tally: Record<RedirectStatus, number> = { ok: 0, flattened: 0, exists: 0, duplicate: 0, self: 0, loop: 0, invalid: 0 };
    for (const row of planned) tally[row.status] += 1;
    return tally;
  }, [planned]);
  const toCreate = planned.filter((row) => row.status === "ok" || row.status === "flattened");
  const visible = filter === "all" ? planned : planned.filter((row) => row.status === filter);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const shown = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
    setPage(0);
    setResult(null);
  };

  const create = async () => {
    setRunning(true);
    setResult(null);
    const changes: ClientChange[] = toCreate.map((row) => ({ key: row.from, item: { kind: "redirectCreate", path: row.from, target: row.to } }));
    let created = 0;
    let failed = 0;
    let firstError: string | null = null;
    await runChanges(changes, {
      history: { runId: newRunId(), tool: "Redirect manager", label: `Create ${changes.length} redirects` },
      onOutcomes: (outcomes) => {
        for (const { outcome } of outcomes) {
          if (outcome.ok) created += 1;
          else {
            failed += 1;
            firstError ??= outcome.error ?? null;
          }
        }
      },
    });
    setRunning(false);
    setResult({ created, failed, error: firstError });
    if (created > 0) void loadExisting();
  };

  const exportProblems = () =>
    downloadCsv(
      buildCsv(["Type", "From", "To"], [...(problems?.loops ?? []).map((r) => ["Loop", r.path, r.target]), ...(problems?.chains ?? []).map((r) => ["Chain", r.path, r.target])]),
      "redirect-problems.csv",
    );

  return (
    <Page fullWidth title="Redirect manager" subtitle="Import redirects from a CSV without creating loops or chains, and check the ones you already have.">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">1. Your store&apos;s current redirects</Text>
            <InlineStack gap="300" blockAlign="center">
              <Button variant="primary" onClick={() => void loadExisting()} loading={loading} disabled={loading}>{existing ? "Reload" : "Load redirects"}</Button>
              <Text as="span" tone="subdued">{loading ? `Read ${existing?.length.toLocaleString() ?? 0} so far…` : existing ? `${existing.length.toLocaleString()} redirects loaded` : "Needed first, so new ones are checked against what's already there."}</Text>
            </InlineStack>
            {error && <Banner tone="critical"><p>{error}</p></Banner>}
            {existing && problems && (
              <>
                <div className="stat-grid">
                  <StatTile label="Redirects" value={existing.length} />
                  <StatTile label="Chains (two or more hops)" value={problems.chains.length} tone={problems.chains.length > 0 ? "caution" : "success"} />
                  <StatTile label="Loops (never end)" value={problems.loops.length} tone={problems.loops.length > 0 ? "critical" : "success"} />
                </div>
                {problems.chains.length + problems.loops.length > 0 && <InlineStack><Button onClick={exportProblems}>Download chains and loops CSV</Button></InlineStack>}
              </>
            )}
          </BlockStack>
        </Card>

        {existing && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">2. Import new redirects</Text>
              <Text as="p" tone="subdued">Two columns: the old path and where it should go. Paste them, or choose a CSV file.</Text>
              <TextField label="Redirects (from,to)" labelHidden value={text} onChange={(value) => { setText(value); setPage(0); setResult(null); }} multiline={6} autoComplete="off" placeholder={SAMPLE} monospaced disabled={running} />
              <InlineStack gap="300" blockAlign="center">
                <input ref={fileInput} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ""; }} />
                <Button onClick={() => fileInput.current?.click()} disabled={running}>Choose CSV file</Button>
                {text && <Button variant="tertiary" onClick={() => { setText(""); setResult(null); }}>Clear</Button>}
              </InlineStack>

              {planned.length > 0 && (
                <>
                  <div className="stat-grid">
                    <StatTile label="Rows" value={planned.length} active={filter === "all"} onClick={() => { setFilter("all"); setPage(0); }} />
                    <StatTile label="Will create" value={counts.ok + counts.flattened} tone="success" active={filter === "ok"} onClick={() => { setFilter(filter === "ok" ? "all" : "ok"); setPage(0); }} />
                    <StatTile label="Already exist" value={counts.exists + counts.duplicate} active={filter === "exists"} onClick={() => { setFilter(filter === "exists" ? "all" : "exists"); setPage(0); }} />
                    <StatTile label="Loops & self-redirects" value={counts.loop + counts.self} tone={counts.loop + counts.self > 0 ? "critical" : "neutral"} active={filter === "loop"} onClick={() => { setFilter(filter === "loop" ? "all" : "loop"); setPage(0); }} />
                    <StatTile label="Invalid" value={counts.invalid} tone={counts.invalid > 0 ? "critical" : "neutral"} active={filter === "invalid"} onClick={() => { setFilter(filter === "invalid" ? "all" : "invalid"); setPage(0); }} />
                  </div>

                  <IndexTable resourceName={{ singular: "redirect", plural: "redirects" }} itemCount={shown.length} selectable={false} headings={[{ title: "#" }, { title: "From" }, { title: "To" }, { title: "Result" }, { title: "Note" }]}>
                    {shown.map((row, index) => (
                      <IndexTable.Row id={`${row.line}`} key={row.line} position={index}>
                        <IndexTable.Cell>{row.line}</IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" truncate>{row.from}</Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" truncate>{row.to}</Text></IndexTable.Cell>
                        <IndexTable.Cell><Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" tone="subdued" truncate>{row.note || "—"}</Text></IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" tone="subdued">{visible.length === 0 ? "Nothing in this view." : `Showing ${(page * PAGE_SIZE + 1).toLocaleString()}–${Math.min((page + 1) * PAGE_SIZE, visible.length).toLocaleString()} of ${visible.length.toLocaleString()}`}</Text>
                    <Pagination hasPrevious={page > 0} hasNext={page < pageCount - 1} onPrevious={() => setPage(page - 1)} onNext={() => setPage(page + 1)} />
                  </InlineStack>

                  <InlineStack gap="300" blockAlign="center">
                    <Button variant="primary" onClick={() => void create()} loading={running} disabled={running || toCreate.length === 0}>{`Create ${toCreate.length.toLocaleString()} redirects`}</Button>
                    <Text as="span" tone="subdued">Rows that exist, repeat, loop or are invalid are skipped.</Text>
                  </InlineStack>
                </>
              )}
              {result && (
                <Banner tone={result.failed === 0 ? "success" : "warning"} title={result.failed === 0 ? "Redirects created" : "Created with problems"}>
                  <p>{`${result.created.toLocaleString()} created · ${result.failed.toLocaleString()} failed${result.error ? ` (${result.error})` : ""}. `}<Link href="/merchant/history">Undo from the change history.</Link></p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
