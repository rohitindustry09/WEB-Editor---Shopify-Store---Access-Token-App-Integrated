"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Banner, BlockStack, Button, Card, IndexTable, InlineStack, Modal, Page, Pagination, Text, Thumbnail } from "@shopify/polaris";
import { Select } from "@/components/ui/Select";
import { StatTile } from "@/components/ui/StatTile";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import { newRunId, runChanges, type ClientChange } from "@/lib/merchant/applyClient";
import { ALT_TEMPLATES, altTextFor, imageIssues, LOW_RES_PX, OVERSIZED_PX, type AltTemplate, type ImageIssue, type ImageRow } from "@/lib/merchant/images";
import { loadImagePageAction } from "./actions";

const PAGE_SIZE = 25;
const FILES_PER_CALL = 25;

const ISSUE_LABEL: Record<ImageIssue, string> = { missingAlt: "No alt text", oversized: `Over ${OVERSIZED_PX}px`, lowRes: `Under ${LOW_RES_PX}px` };

type View = ImageIssue | "all";

export function ImageFixer() {
  const [images, setImages] = useState<ImageRow[]>([]);
  const [productCount, setProductCount] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("missingAlt");
  const [page, setPage] = useState(0);
  const [template, setTemplate] = useState<AltTemplate>("title");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixed, setFixed] = useState<Map<string, string>>(new Map());
  const [message, setMessage] = useState<string | null>(null);
  const stopRef = useRef(false);

  // Images fixed this session show their new alt text, so they drop out of "No alt text" without a rescan.
  const current = useMemo(() => images.map((image) => (fixed.has(image.fileId) ? { ...image, alt: fixed.get(image.fileId) ?? image.alt } : image)), [images, fixed]);
  const withIssues = useMemo(() => current.map((image) => ({ image, issues: imageIssues(image) })), [current]);
  const counts = useMemo(() => {
    const tally = { missingAlt: 0, oversized: 0, lowRes: 0 };
    for (const { issues } of withIssues) for (const issue of issues) tally[issue] += 1;
    return tally;
  }, [withIssues]);

  const visible = view === "all" ? withIssues : withIssues.filter(({ issues }) => issues.includes(view));
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const shown = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const missing = useMemo(() => {
    const byFile = new Map<string, ImageRow>();
    for (const { image, issues } of withIssues) if (issues.includes("missingAlt") && !byFile.has(image.fileId)) byFile.set(image.fileId, image);
    return [...byFile.values()];
  }, [withIssues]);

  const scan = async () => {
    stopRef.current = false;
    setScanning(true);
    setScanned(false);
    setError(null);
    setImages([]);
    setFixed(new Map());
    setMessage(null);
    setPage(0);
    let cursor: string | null = null;
    let collected: ImageRow[] = [];
    let products = 0;
    do {
      const response: Awaited<ReturnType<typeof loadImagePageAction>> = await loadImagePageAction(cursor).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
      if (!response.ok) {
        setError(response.error);
        break;
      }
      const known = new Set(collected.map((image) => `${image.productId}-${image.fileId}`));
      collected = collected.concat(response.images.filter((image) => !known.has(`${image.productId}-${image.fileId}`)));
      products += response.products;
      cursor = response.nextCursor;
      setImages(collected);
      setProductCount(products);
    } while (cursor && !stopRef.current);
    setScanning(false);
    setScanned(true);
  };

  const fixAlt = async () => {
    setConfirmOpen(false);
    setFixing(true);
    setMessage(null);
    const changes: ClientChange[] = [];
    for (let index = 0; index < missing.length; index += FILES_PER_CALL) {
      const slice = missing.slice(index, index + FILES_PER_CALL);
      changes.push({
        key: `alt#${index}`,
        item: { kind: "mediaAlt", files: slice.map((image) => ({ id: image.fileId, alt: altTextFor(image, template) })) },
        entries: slice.map((image) => ({ kind: "mediaAlt", fileId: image.fileId, label: `${image.productTitle} · image ${image.position}`, before: "", after: altTextFor(image, template) })),
      });
    }
    const sizeOf = new Map(changes.map((change) => [change.key, change.entries?.length ?? 0]));
    const done = new Map<string, string>();
    let firstError: string | null = null;
    await runChanges(changes, {
      history: { runId: newRunId(), tool: "Image fixer", label: `Add alt text to ${missing.length} images (${ALT_TEMPLATES.find((t) => t.value === template)?.label})` },
      onOutcomes: (outcomes) => {
        for (const { key, outcome } of outcomes) {
          if (!outcome.ok) {
            firstError ??= outcome.error ?? null;
            continue;
          }
          const index = Number(key.split("#")[1]);
          for (const image of missing.slice(index, index + (sizeOf.get(key) ?? 0))) done.set(image.fileId, altTextFor(image, template));
        }
      },
    });
    setFixed((prev) => new Map([...prev, ...done]));
    setFixing(false);
    setMessage(`${done.size.toLocaleString()} of ${missing.length.toLocaleString()} images now have alt text.${done.size < missing.length ? ` Some failed: ${firstError ?? "unknown error"}` : ""}`);
  };

  const exportCsv = () =>
    downloadCsv(
      buildCsv(
        ["Product", "Image #", "Issues", "Alt text", "Width", "Height", "Image URL"],
        withIssues.filter(({ issues }) => issues.length > 0).map(({ image, issues }) => [image.productTitle, String(image.position), issues.map((i) => ISSUE_LABEL[i]).join("; "), image.alt, String(image.width), String(image.height), image.url]),
      ),
      "image-issues.csv",
    );

  return (
    <Page fullWidth title="Image fixer" subtitle="Find product images with no alt text, or that are far too big or too small — and add the missing alt text in one go.">
      <BlockStack gap="400">
        <Card>
          <InlineStack gap="300" blockAlign="center">
            <Button variant="primary" onClick={() => void scan()} loading={scanning} disabled={scanning}>Scan product images</Button>
            {scanning && <Button onClick={() => { stopRef.current = true; }}>Stop</Button>}
            <Text as="span" tone="subdued">
              {scanning ? `Read ${images.length.toLocaleString()} images from ${productCount.toLocaleString()} products…` : scanned ? `${images.length.toLocaleString()} images from ${productCount.toLocaleString()} products scanned (first 20 images of each product)` : "Reads every product's images — this can take a minute on a big catalog."}
            </Text>
          </InlineStack>
          {error && <div style={{ marginTop: 12 }}><Banner tone="critical"><p>{error}</p></Banner></div>}
        </Card>

        {scanned && (
          <Card>
            <BlockStack gap="400">
              <div className="stat-grid">
                <StatTile label="Images scanned" value={images.length} active={view === "all"} onClick={() => { setView("all"); setPage(0); }} />
                <StatTile label={ISSUE_LABEL.missingAlt} value={counts.missingAlt} tone={counts.missingAlt > 0 ? "critical" : "success"} active={view === "missingAlt"} onClick={() => { setView("missingAlt"); setPage(0); }} />
                <StatTile label={ISSUE_LABEL.oversized} value={counts.oversized} tone={counts.oversized > 0 ? "caution" : "success"} active={view === "oversized"} onClick={() => { setView("oversized"); setPage(0); }} />
                <StatTile label={ISSUE_LABEL.lowRes} value={counts.lowRes} tone={counts.lowRes > 0 ? "caution" : "success"} active={view === "lowRes"} onClick={() => { setView("lowRes"); setPage(0); }} />
              </div>

              {counts.missingAlt > 0 && (
                <InlineStack gap="300" blockAlign="end">
                  <div style={{ minWidth: 280 }}>
                    <Select label="Write alt text as" options={ALT_TEMPLATES.map((t) => ({ label: `${t.label} — e.g. ${t.example}`, value: t.value }))} value={template} onChange={(value) => setTemplate(value as AltTemplate)} disabled={fixing} />
                  </div>
                  <Button variant="primary" onClick={() => setConfirmOpen(true)} loading={fixing} disabled={fixing}>{`Add alt text to ${missing.length.toLocaleString()} images`}</Button>
                </InlineStack>
              )}
              {message && <Banner tone="info" onDismiss={() => setMessage(null)}><p>{message} <Link href="/merchant/history">Undo it from the change history.</Link></p></Banner>}

              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">{view === "all" ? "All images" : ISSUE_LABEL[view]}</Text>
                <Button onClick={exportCsv} disabled={counts.missingAlt + counts.oversized + counts.lowRes === 0}>Download issues CSV</Button>
              </InlineStack>

              {visible.length === 0 ? (
                <Banner tone="success"><p>Nothing to fix here.</p></Banner>
              ) : (
                <>
                  <IndexTable resourceName={{ singular: "image", plural: "images" }} itemCount={shown.length} selectable={false} headings={[{ title: "" }, { title: "Product" }, { title: "Alt text" }, { title: "Size" }, { title: "Issues" }]}>
                    {shown.map(({ image, issues }, index) => (
                      <IndexTable.Row id={`${image.productId}-${image.fileId}`} key={`${image.productId}-${image.fileId}`} position={index}>
                        <IndexTable.Cell><Thumbnail source={image.url} alt={image.alt || image.productTitle} size="small" /></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" truncate>{`${image.productTitle} · image ${image.position}`}</Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" tone={image.alt ? undefined : "subdued"} truncate>{image.alt || "—"}</Text></IndexTable.Cell>
                        <IndexTable.Cell>{image.width && image.height ? `${image.width} × ${image.height}` : "—"}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <InlineStack gap="100">{issues.length === 0 ? <Badge tone="success">Fine</Badge> : issues.map((issue) => <Badge key={issue} tone={issue === "missingAlt" ? "critical" : "attention"}>{ISSUE_LABEL[issue]}</Badge>)}</InlineStack>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" tone="subdued">{`Showing ${(page * PAGE_SIZE + 1).toLocaleString()}–${Math.min((page + 1) * PAGE_SIZE, visible.length).toLocaleString()} of ${visible.length.toLocaleString()}`}</Text>
                    <Pagination hasPrevious={page > 0} hasNext={page < pageCount - 1} onPrevious={() => setPage(page - 1)} onNext={() => setPage(page + 1)} />
                  </InlineStack>
                </>
              )}
            </BlockStack>
          </Card>
        )}
      </BlockStack>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={`Add alt text to ${missing.length.toLocaleString()} images?`} primaryAction={{ content: "Add alt text", onAction: () => void fixAlt() }} secondaryActions={[{ content: "Cancel", onAction: () => setConfirmOpen(false) }]}>
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">{`Each image without alt text gets one built from its product (${ALT_TEMPLATES.find((t) => t.value === template)?.label.toLowerCase()}). Images that already have alt text are not touched.`}</Text>
            <Text as="p" tone="subdued">The change is saved in the change history, so you can undo it.</Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
