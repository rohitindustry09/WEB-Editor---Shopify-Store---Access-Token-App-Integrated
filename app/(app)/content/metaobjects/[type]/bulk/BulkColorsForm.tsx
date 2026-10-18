"use client";

import { useState, useTransition, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  DataTable,
  DropZone,
  Icon,
  Badge,
} from "@shopify/polaris";
import { Select } from "@/components/ui/Select";
import { FileIcon, XCircleIcon } from "@shopify/polaris-icons";
import { createEntryAction, checkDuplicateNamesAction, prepareBulkImportAction } from "../actions";

interface BulkColorRow {
  name: string;
  hex: string;
  baseColor: string;
}

type RowState = "idle" | "duplicate" | "processing" | "added" | "error";

interface RowStatus {
  state: RowState;
  message?: string;
}

function parseCsv(text: string): BulkColorRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const rows: BulkColorRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (i === 0 && /name/i.test(cells[0] ?? "") && /hex/i.test(cells[1] ?? "")) continue; // header row
    const [name, hex, baseColor] = cells;
    if (!name) continue;
    rows.push({ name, hex: hex ?? "", baseColor: baseColor ?? "" });
  }
  return rows;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeHex(hex: string): string {
  const trimmed = hex.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function statusBadge(status: RowStatus | undefined) {
  switch (status?.state) {
    case "processing":
      return <Badge tone="info">Processing…</Badge>;
    case "added":
      return <Badge tone="success">Added</Badge>;
    case "error":
      return <Badge tone="critical">Error</Badge>;
    case "duplicate":
      return <Badge tone="warning">Already in store</Badge>;
    default:
      return <Badge>Not started</Badge>;
  }
}

interface PatternOption {
  id: string;
  label: string;
}

interface FieldSummary {
  key: string;
  name: string;
  typeName: string;
}

export function BulkColorsForm({
  type,
  definitionName,
  patternOptions,
  fieldDefinitions,
}: {
  type: string;
  definitionName: string;
  patternOptions: PatternOption[];
  fieldDefinitions: FieldSummary[];
}) {
  const [showFields, setShowFields] = useState(false);
  const defaultPatternId =
    patternOptions.find((p) => p.label.toLowerCase() === "solid")?.id ?? patternOptions[0]?.id ?? "";
  const [rows, setRows] = useState<BulkColorRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [patternId, setPatternId] = useState(defaultPatternId);
  const [rowStatus, setRowStatus] = useState<Record<number, RowStatus>>({});
  const [checked, setChecked] = useState(false);
  const [checking, startCheckTransition] = useTransition();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setStatus = (index: number, status: RowStatus) =>
    setRowStatus((prev) => ({ ...prev, [index]: status }));

  const handleFile = useCallback((pickedFile: File) => {
    setFile(pickedFile);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ""));
      setRows(parsed);
      setChecked(false);
      setRowStatus({});
      setError(null);
    };
    reader.readAsText(pickedFile);
  }, []);

  const handleDrop = useCallback(
    (_dropFiles: File[], acceptedFiles: File[]) => {
      if (acceptedFiles[0]) handleFile(acceptedFiles[0]);
    },
    [handleFile],
  );

  const clearFile = () => {
    setFile(null);
    setRows([]);
    setChecked(false);
    setRowStatus({});
    setError(null);
  };

  const runCheck = () => {
    startCheckTransition(async () => {
      const check = await checkDuplicateNamesAction(type, rows.map((r) => r.name));
      const duplicateNames = new Set(check.duplicates.map((n) => n.toLowerCase()));
      const next: Record<number, RowStatus> = {};
      rows.forEach((row, i) => {
        if (duplicateNames.has(row.name.trim().toLowerCase())) next[i] = { state: "duplicate" };
      });
      setRowStatus(next);
      setChecked(true);
    });
  };

  const runImport = async () => {
    setError(null);
    setImporting(true);
    try {
      const plan = await prepareBulkImportAction(type, patternId || undefined);
      if ("error" in plan) {
        setError(plan.error);
        return;
      }

      const seenNames = new Set(
        Object.entries(rowStatus)
          .filter(([, s]) => s.state === "duplicate")
          .map(([i]) => rows[Number(i)].name.trim().toLowerCase()),
      );

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (rowStatus[i]?.state === "duplicate") continue;
        if (!row.name.trim() || !row.hex.trim()) continue;

        const key = row.name.trim().toLowerCase();
        if (seenNames.has(key)) {
          setStatus(i, { state: "duplicate", message: "Duplicate within this file" });
          continue;
        }

        setStatus(i, { state: "processing" });

        const baseColorId = plan.baseColorMap[row.baseColor.trim().toLowerCase()];
        if (!baseColorId) {
          setStatus(i, { state: "error", message: `Base color "${row.baseColor}" not recognized` });
          continue;
        }

        const fields: { key: string; value: string }[] = [
          { key: plan.nameKey, value: row.name.trim() },
          { key: plan.colorKey, value: normalizeHex(row.hex) },
          { key: plan.baseColorKey, value: plan.baseColorIsList ? JSON.stringify([baseColorId]) : baseColorId },
        ];
        if (plan.basePatternKey && plan.resolvedPatternId) {
          fields.push({
            key: plan.basePatternKey,
            value: plan.basePatternIsList ? JSON.stringify([plan.resolvedPatternId]) : plan.resolvedPatternId,
          });
        }

        const created = await createEntryAction(type, fields);
        if (created.ok) {
          setStatus(i, { state: "added" });
          seenNames.add(key);
        } else {
          setStatus(i, { state: "error", message: created.error });
        }
      }
    } finally {
      setImporting(false);
    }
  };

  const pendingCount = rows.filter((_, i) => rowStatus[i]?.state !== "duplicate" && rowStatus[i]?.state !== "added").length;
  const addedCount = Object.values(rowStatus).filter((s) => s.state === "added").length;
  const errorCount = Object.values(rowStatus).filter((s) => s.state === "error").length;
  const duplicateIndexes = rows
    .map((_, i) => i)
    .filter((i) => rowStatus[i]?.state === "duplicate");
  const duplicateCount = duplicateIndexes.length;
  const duplicateNamesList = Array.from(new Set(duplicateIndexes.map((i) => rows[i].name)));

  return (
    <Page fullWidth title={`Bulk add ${definitionName.toLowerCase()}`} backAction={{ content: definitionName, url: `/content/metaobjects/${encodeURIComponent(type)}` }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingSm">Upload a CSV</Text>
              <Text as="p" tone="subdued">
                Three columns, no header required: <b>Brand Colour Name</b>, <b>HEX Code</b>, <b>Base Color</b>.
                The base pattern below is applied to every row.
              </Text>

              <InlineStack>
                <Button variant="plain" onClick={() => setShowFields((v) => !v)}>
                  {showFields ? "Hide" : "Show"} this definition&apos;s fields
                </Button>
              </InlineStack>
              {showFields && (
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Field name", "Key", "Type"]}
                  rows={fieldDefinitions.map((f) => [f.name, f.key, f.typeName])}
                />
              )}

              {patternOptions.length === 0 && (
                <Banner tone="warning">
                  <p>Couldn&apos;t find a &ldquo;Base pattern&rdquo; reference field on this definition — rows will be created without one.</p>
                </Banner>
              )}

              {file ? (
                <Card background="bg-surface-secondary">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Icon source={FileIcon} tone="subdued" />
                      <BlockStack gap="0">
                        <Text as="span" fontWeight="medium">{file.name}</Text>
                        <Text as="span" tone="subdued" variant="bodySm">{formatFileSize(file.size)}</Text>
                      </BlockStack>
                    </InlineStack>
                    <Button
                      icon={XCircleIcon}
                      variant="plain"
                      accessibilityLabel="Remove file"
                      onClick={clearFile}
                    />
                  </InlineStack>
                </Card>
              ) : (
                <DropZone accept=".csv,text/csv" type="file" onDrop={handleDrop}>
                  <DropZone.FileUpload actionTitle="Add file" actionHint="or drop a CSV to upload" />
                </DropZone>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {error && (
          <Layout.Section>
            <Banner tone="critical"><p>{error}</p></Banner>
          </Layout.Section>
        )}

        {rows.length > 0 && (
          <Layout.Section>
            <Card padding="0">
              <BlockStack gap="0">
                <div style={{ padding: "1rem" }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Text as="span" tone="subdued">{rows.length} rows parsed</Text>
                      {importing && (
                        <Text as="span" tone="subdued">
                          {addedCount} added
                          {errorCount > 0 ? `, ${errorCount} errored` : ""}
                        </Text>
                      )}
                    </InlineStack>
                    <InlineStack gap="300" blockAlign="center">
                      {patternOptions.length > 0 && (
                        <div style={{ minWidth: 220 }}>
                          <Select
                            label="Base pattern"
                            labelInline
                            options={patternOptions.map((p) => ({ label: p.label, value: p.id }))}
                            value={patternId}
                            onChange={setPatternId}
                            disabled={importing}
                          />
                        </div>
                      )}
                      <Button loading={checking} disabled={importing} onClick={runCheck}>Check against store</Button>
                      <Button
                        variant="primary"
                        loading={importing}
                        disabled={!checked || pendingCount === 0}
                        onClick={runImport}
                      >
                        {`Import ${pendingCount} new color${pendingCount === 1 ? "" : "s"}`}
                      </Button>
                    </InlineStack>
                  </InlineStack>
                </div>

                {checked && duplicateCount > 0 && (
                  <div style={{ padding: "0 1rem 1rem" }}>
                    <Banner tone="warning" title={`${duplicateCount} already in the store`}>
                      <p>{duplicateNamesList.join(", ")}</p>
                    </Banner>
                  </div>
                )}

                <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Name", "Hex", "Base color", "Status", "Detail"].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: "left",
                            padding: "0.5rem 1rem",
                            borderTop: "1px solid var(--p-color-border)",
                            borderBottom: "1px solid var(--p-color-border)",
                            fontSize: "0.75rem",
                            color: "var(--p-color-text-secondary)",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td style={{ padding: "0.5rem 1rem", borderBottom: "1px solid var(--p-color-border)" }}>{r.name}</td>
                        <td style={{ padding: "0.5rem 1rem", borderBottom: "1px solid var(--p-color-border)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span
                              aria-hidden
                              style={{
                                display: "inline-block",
                                width: 16,
                                height: 16,
                                borderRadius: 4,
                                flexShrink: 0,
                                background: /^#?[0-9a-fA-F]{6,8}$/.test(r.hex) ? normalizeHex(r.hex) : "transparent",
                                border: "1px solid var(--p-color-border)",
                              }}
                            />
                            <Text as="span" tone="subdued">{r.hex}</Text>
                          </div>
                        </td>
                        <td style={{ padding: "0.5rem 1rem", borderBottom: "1px solid var(--p-color-border)" }}>{r.baseColor}</td>
                        <td style={{ padding: "0.5rem 1rem", borderBottom: "1px solid var(--p-color-border)" }}>
                          {statusBadge(rowStatus[i])}
                        </td>
                        <td style={{ padding: "0.5rem 1rem", borderBottom: "1px solid var(--p-color-border)" }}>
                          <Text as="span" tone={rowStatus[i]?.state === "error" ? "critical" : "subdued"} variant="bodySm">
                            {rowStatus[i]?.message ?? ""}
                          </Text>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
