"use client";

import { useState } from "react";
import { Badge, Banner, BlockStack, Box, Button, ButtonGroup, Checkbox, DataTable, InlineStack, Modal, ProgressBar, Text } from "@shopify/polaris";
import { ExportIcon, ImportIcon, EditIcon } from "@shopify/polaris-icons";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import { idFromGid } from "@/lib/format";
import type { CompareResult } from "@/lib/storeCompare";
import type { ApplyFieldKey, ApplyFieldValues, ProductStatusValue, SkuTarget } from "@/lib/skuApply";
import type { ScrapedProduct } from "@/lib/storeScraper/types";
import type { useBulkApplyRunner, RunItem } from "./useBulkApplyRunner";

export type CompareTab = "matched" | "connected" | "url";

const UPDATE_FIELDS: { key: ApplyFieldKey; label: string; help: string }[] = [
  { key: "title", label: "Title", help: "" },
  { key: "descriptionHtml", label: "Description", help: "" },
  { key: "vendor", label: "Vendor", help: "" },
  { key: "productType", label: "Product type", help: "Taken from the other store's first category" },
  { key: "tags", label: "Tags", help: "Replaces the product's current tags" },
  { key: "price", label: "Price", help: "Copied as a plain number — no currency conversion" },
  { key: "compareAtPrice", label: "Compare-at price", help: "Copied as a plain number — no currency conversion" },
];

const STATUS_CHOICES: { value: ProductStatusValue; label: string }[] = [
  { value: "DRAFT", label: "Draft" },
  { value: "ACTIVE", label: "Active" },
  { value: "ARCHIVED", label: "Archived" },
];

/** Everything the other store gives us for a product, as the same field values the Upload & Update tool writes. Blank values are left out so they never overwrite anything. */
function scrapedValues(product: ScrapedProduct): ApplyFieldValues {
  const values: ApplyFieldValues = {};
  if (product.name.trim()) values.title = product.name.trim();
  if (product.descriptionHtml?.trim()) values.descriptionHtml = product.descriptionHtml;
  if (product.vendor?.trim()) values.vendor = product.vendor.trim();
  const category = product.categories[0]?.trim();
  if (category) values.productType = category;
  if (product.tags.length > 0) values.tags = product.tags.join(", ");
  if (product.price !== null && product.price >= 0) values.price = product.price.toFixed(2);
  if (product.compareAtPrice !== null && product.compareAtPrice > 0) values.compareAtPrice = product.compareAtPrice.toFixed(2);
  return values;
}

function fileSafe(value: string): string {
  return value.replace(/[^a-z0-9.-]+/gi, "-").replace(/^-+|-+$/g, "") || "store";
}

export function CompareActions({
  tab,
  result,
  storeName,
  urlStoreName,
  shopDomain,
  currencyCode,
  target,
  runner,
}: {
  tab: CompareTab;
  result: CompareResult;
  storeName: string;
  urlStoreName: string;
  shopDomain: string;
  /** The connected store's currency — compared against the other store's to warn about unconverted prices. */
  currencyCode: string;
  /** Where a new product's SKU is written; null when the chosen SKU field can't hold it. */
  target: SkuTarget | null;
  runner: ReturnType<typeof useBulkApplyRunner>;
}) {
  const [updateOpen, setUpdateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [updateFields, setUpdateFields] = useState<Set<ApplyFieldKey>>(new Set());
  const [addStatus, setAddStatus] = useState<ProductStatusValue>("DRAFT");
  const [includeImages, setIncludeImages] = useState(true);

  const updatable = result.matched.filter((row) => !row.shared);
  const sharedCount = result.matched.length - updatable.length;
  const addable = result.urlOnly.filter((row) => !runner.doneKeys.has(`c:${row.sku}`));

  const otherCurrency = result.matched.find((m) => m.scraped.currency)?.scraped.currency ?? result.urlOnly.find((u) => u.scraped.currency)?.scraped.currency ?? null;
  const currencyMismatch = Boolean(otherCurrency && currencyCode && otherCurrency.toUpperCase() !== currencyCode.toUpperCase());

  const toggleField = (key: ApplyFieldKey, on: boolean) =>
    setUpdateFields((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const runUpdate = () => {
    setUpdateOpen(false);
    const items: RunItem[] = updatable.map((row) => {
      const all = scrapedValues(row.scraped);
      const values: ApplyFieldValues = {};
      for (const key of updateFields) if (all[key] !== undefined) values[key] = all[key];
      return { key: `u:${row.sku}`, item: { kind: "update", productId: row.connected.productId, variantId: row.connected.variantId, values } };
    });
    void runner.run(items);
  };

  const runAdd = () => {
    if (!target) return;
    setAddOpen(false);
    const items: RunItem[] = addable.map((row) => ({
      key: `c:${row.sku}`,
      item: {
        kind: "create",
        sku: row.sku,
        target,
        values: { ...scrapedValues(row.scraped), status: addStatus },
        imageUrls: includeImages ? row.scraped.images : [],
      },
    }));
    void runner.run(items);
  };

  const downloadConnectedExport = () => {
    const csv = buildCsv(
      ["SKU", "Title", "Handle", "Status", "Product ID", "Variant ID", "Image URL", "Admin link"],
      result.connectedOnly.map((row) => [
        row.sku,
        row.connected.title,
        row.connected.handle,
        row.connected.status,
        idFromGid(row.connected.productId),
        row.connected.variantId ? idFromGid(row.connected.variantId) : "",
        row.connected.imageUrl ?? "",
        shopDomain ? `https://${shopDomain}/admin/products/${idFromGid(row.connected.productId)}` : "",
      ]),
    );
    downloadCsv(csv, `${fileSafe(storeName)}-not-in-${fileSafe(urlStoreName)}.csv`);
  };

  const downloadResults = () => {
    downloadCsv(
      buildCsv(
        ["SKU", "Action", "Result", "Details", "Product ID"],
        runner.outcomes.map((o) => [
          o.key.slice(2),
          o.action === "update" ? "Update" : "Create",
          o.result.ok ? "Success" : "Failed",
          o.result.error ?? o.result.note ?? "",
          o.result.productId ? idFromGid(o.result.productId) : "",
        ]),
      ),
      "store-compare-results.csv",
    );
  };

  const failed = runner.outcomes.filter((o) => !o.result.ok);
  const succeeded = runner.outcomes.filter((o) => o.result.ok);
  const withNotes = succeeded.filter((o) => o.result.note).length;

  return (
    <BlockStack gap="300">
      <InlineStack gap="300" blockAlign="center">
        {tab === "matched" && (
          <>
            <Button variant="primary" icon={EditIcon} disabled={runner.running || updatable.length === 0} onClick={() => setUpdateOpen(true)}>
              {`Update matched (${updatable.length.toLocaleString()})`}
            </Button>
            {sharedCount > 0 && (
              <Text as="span" variant="bodySm" tone="subdued">{`${sharedCount.toLocaleString()} shared SKU${sharedCount === 1 ? "" : "s"} left out — several ${storeName} products use them`}</Text>
            )}
          </>
        )}
        {tab === "connected" && (
          <Button variant="primary" icon={ExportIcon} disabled={result.connectedOnly.length === 0} onClick={downloadConnectedExport}>
            {`Download export (${result.connectedOnly.length.toLocaleString()})`}
          </Button>
        )}
        {tab === "url" && (
          <>
            <Button variant="primary" icon={ImportIcon} disabled={runner.running || addable.length === 0 || target === null} onClick={() => setAddOpen(true)}>
              {`Add new products (${addable.length.toLocaleString()})`}
            </Button>
            {target === null && (
              <Text as="span" variant="bodySm" tone="caution">New products need the variant SKU or a single-line text metafield as the connected store&apos;s SKU field.</Text>
            )}
            {result.urlNoSku.length > 0 && (
              <Text as="span" variant="bodySm" tone="subdued">{`${result.urlNoSku.length.toLocaleString()} product${result.urlNoSku.length === 1 ? " has" : "s have"} no SKU and can't be added`}</Text>
            )}
          </>
        )}
      </InlineStack>

      {runner.running && (
        <Box padding="400" background="bg-surface-secondary" borderWidth="025" borderColor="border" borderRadius="300">
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" variant="headingSm">{`Processed ${runner.progress.done.toLocaleString()} of ${runner.progress.total.toLocaleString()}`}</Text>
              <Button variant="tertiary" tone="critical" onClick={runner.cancel} disabled={runner.stopping} loading={runner.stopping}>
                {runner.stopping ? "Stopping after the products in progress…" : "Stop"}
              </Button>
            </InlineStack>
            <ProgressBar progress={runner.progress.total > 0 ? (runner.progress.done / runner.progress.total) * 100 : 0} tone="primary" size="small" />
          </BlockStack>
        </Box>
      )}

      {!runner.running && runner.outcomes.length > 0 && (
        <BlockStack gap="300">
          <Banner tone={failed.length === 0 ? "success" : "warning"} title={runner.cancelled ? "Stopped early" : "Finished"} onDismiss={runner.dismiss}>
            <p>
              {`${succeeded.length.toLocaleString()} succeeded · ${failed.length.toLocaleString()} failed`}
              {withNotes > 0 ? ` · ${withNotes.toLocaleString()} with a note (see the results CSV)` : ""}
              {runner.cancelled ? " — the rest were not processed." : ""}
              {succeeded.some((o) => o.action === "create") ? " Run Load & compare again to refresh the lists." : ""}
            </p>
          </Banner>
          <InlineStack><Button onClick={downloadResults}>Download results CSV</Button></InlineStack>
          {failed.length > 0 && (
            <DataTable
              columnContentTypes={["text", "text", "text"]}
              headings={["SKU", "Action", "Why it failed"]}
              rows={failed.slice(0, 50).map((o) => [o.key.slice(2), o.action === "update" ? "Update" : "Create", o.result.error ?? ""])}
              truncate
            />
          )}
        </BlockStack>
      )}

      <Modal
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
        title={`Update ${updatable.length.toLocaleString()} matched products?`}
        primaryAction={{ content: `Update (${updatable.length.toLocaleString()})`, onAction: runUpdate, disabled: updateFields.size === 0 }}
        secondaryActions={[{ content: "Cancel", onAction: () => setUpdateOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              Choose what to copy from <Text as="span" fontWeight="semibold">{urlStoreName}</Text> onto the matching products in{" "}
              <Text as="span" fontWeight="semibold">{storeName}</Text>. Anything you leave unticked is not touched, and a value the other store doesn&apos;t have never erases yours.
            </Text>
            <BlockStack gap="150">
              {UPDATE_FIELDS.map((field) => (
                <Checkbox
                  key={field.key}
                  label={field.label}
                  helpText={field.help || undefined}
                  checked={updateFields.has(field.key)}
                  onChange={(on) => toggleField(field.key, on)}
                />
              ))}
            </BlockStack>
            {currencyMismatch && updateFields.has("price") && (
              <Banner tone="warning">
                <p>{`${urlStoreName} prices are in ${otherCurrency}, ${storeName} uses ${currencyCode}. Prices are copied as plain numbers — nothing is converted.`}</p>
              </Banner>
            )}
            <Text as="p" variant="bodySm" tone="subdued">There is no bulk undo. Price changes apply to the matched variant only.</Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={`Add ${addable.length.toLocaleString()} new products?`}
        primaryAction={{ content: `Add products (${addable.length.toLocaleString()})`, onAction: runAdd }}
        secondaryActions={[{ content: "Cancel", onAction: () => setAddOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              Creates these products in <Text as="span" fontWeight="semibold">{storeName}</Text> from <Text as="span" fontWeight="semibold">{urlStoreName}</Text>: title, description, vendor, category, tags, prices and the SKU.
            </Text>
            <BlockStack gap="100">
              <Text as="p" variant="headingSm">Status for the new products</Text>
              <ButtonGroup variant="segmented">
                {STATUS_CHOICES.map((choice) => (
                  <Button key={choice.value} pressed={addStatus === choice.value} onClick={() => setAddStatus(choice.value)}>
                    {choice.label}
                  </Button>
                ))}
              </ButtonGroup>
            </BlockStack>
            <Checkbox
              label="Include product images"
              helpText="Shopify downloads them from the other store's links. Up to 20 per product."
              checked={includeImages}
              onChange={setIncludeImages}
            />
            {currencyMismatch && (
              <Banner tone="warning">
                <p>{`${urlStoreName} prices are in ${otherCurrency}, ${storeName} uses ${currencyCode}. Prices are copied as plain numbers — nothing is converted.`}</p>
              </Banner>
            )}
            <InlineStack gap="200">
              <Badge tone="info">{`${addable.length.toLocaleString()} products`}</Badge>
              <Badge>{`Status: ${STATUS_CHOICES.find((c) => c.value === addStatus)?.label}`}</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">There is no bulk undo. Each SKU is only added once per session, so pressing this again won&apos;t duplicate it.</Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}
