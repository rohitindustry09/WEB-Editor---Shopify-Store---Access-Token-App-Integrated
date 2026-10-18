"use client";

import { useState } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Checkbox,
  Collapsible,
  Divider,
  InlineStack,
  Pagination,
  Text,
} from "@shopify/polaris";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ExportIcon,
} from "@shopify/polaris-icons";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import { idFromGid } from "@/lib/format";
import type { UpdateGroup } from "@/lib/skuMatch";

const PAGE_SIZE = 10;

const STATUS_TONE: Record<string, "success" | "info" | undefined> = {
  ACTIVE: "success",
  DRAFT: "info",
  ARCHIVED: undefined,
};

/** The distinct store products behind a shared SKU (one entry per product, even if several of its variants carry the SKU). */
export function sharedProducts(group: UpdateGroup) {
  const seen = new Set<string>();
  return group.matches.filter((match) => {
    if (seen.has(match.productId)) return false;
    seen.add(match.productId);
    return true;
  });
}

/**
 * Shared SKUs — CSV SKUs that more than one store product carries. They are
 * skipped by default (an update there is ambiguous); this lists every one with
 * the products behind it and lets the user choose to update them anyway, in
 * which case the CSV row is applied to each of those products.
 */
/** One CSV row per store product behind a shared SKU, beside the CSV row that carries the SKU — so it can be reviewed or fixed in a spreadsheet. */
function downloadSharedSkus(groups: UpdateGroup[], headers: string[]): void {
  const width = headers.length;
  const rows = groups.flatMap((group) => {
    const csvCells = Array.from(
      { length: width },
      (_, index) => group.rows[0]?.cells[index] ?? "",
    );
    const products = sharedProducts(group);
    return products.map((product) => [
      ...csvCells,
      product.sku,
      String(products.length),
      product.title,
      idFromGid(product.productId),
      product.variantId ? idFromGid(product.variantId) : "",
      product.status.toLowerCase(),
      product.handle,
    ]);
  });
  downloadCsv(
    buildCsv(
      [
        ...headers,
        "Store SKU",
        "Products sharing this SKU",
        "Store product",
        "Store product ID",
        "Store variant ID",
        "Store status",
        "Store handle",
      ],
      rows,
    ),
    "upload-products-shared-skus.csv",
  );
}

export function SharedSkusPanel({
  groups,
  headers,
  include,
  onIncludeChange,
  disabled,
}: {
  groups: UpdateGroup[];
  /** The CSV's column names, so the download keeps each SKU's original CSV row. */
  headers: string[];
  include: boolean;
  onIncludeChange: (include: boolean) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);

  if (groups.length === 0) return null;

  const productCount = groups.reduce(
    (sum, group) => sum + sharedProducts(group).length,
    0,
  );
  const pageCount = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const activePage = Math.min(page, pageCount - 1);
  const visible = groups.slice(
    activePage * PAGE_SIZE,
    (activePage + 1) * PAGE_SIZE,
  );

  return (
    <Box
      background="bg-surface"
      borderWidth="025"
      borderColor="border"
      borderRadius="300"
    >
      <Box padding="300">
        <BlockStack gap="300">
          <InlineStack
            align="space-between"
            blockAlign="center"
            gap="300"
            wrap={false}
          >
            <BlockStack gap="050">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h4" variant="headingSm">
                  Shared SKUs
                </Text>
                <Badge tone="attention">{`${groups.length.toLocaleString()} SKUs · ${productCount.toLocaleString()} products`}</Badge>
                <Badge tone={include ? "success" : undefined}>
                  {include ? "Will be updated" : "Skipped"}
                </Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                More than one store product has each of these SKUs, so by
                default they are left out.
              </Text>
            </BlockStack>
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <Button
                icon={ExportIcon}
                onClick={() => downloadSharedSkus(groups, headers)}
              >
                Download CSV
              </Button>
              <Button
                variant="tertiary"
                icon={open ? ChevronUpIcon : ChevronDownIcon}
                onClick={() => setOpen((v) => !v)}
                ariaExpanded={open}
                ariaControls="shared-skus-list"
                accessibilityLabel={`${open ? "Hide" : "Show"} the shared SKUs`}
              >
                {open ? "Hide list" : "Show list"}
              </Button>
            </InlineStack>
          </InlineStack>

          <Checkbox
            label={`Also update the shared SKUs (${productCount.toLocaleString()} products)`}
            helpText="Each CSV row is applied to every store product that has that SKU, with the same values. Leave this off if only one of them should change."
            checked={include}
            onChange={onIncludeChange}
            disabled={disabled}
          />
        </BlockStack>
      </Box>

      <Collapsible
        open={open}
        id="shared-skus-list"
        transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
      >
        <Divider />
        <Box padding="300">
          <BlockStack gap="300">
            <div role="list">
              {visible.map((group) => {
                const products = sharedProducts(group);
                return (
                  <div role="listitem" key={group.sku}>
                    <Box
                      paddingBlock="200"
                      borderBlockEndWidth="025"
                      borderColor="border"
                    >
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" fontWeight="semibold">
                            {group.sku}
                          </Text>
                          <Badge tone="attention">{`${products.length} products`}</Badge>
                        </InlineStack>
                        {products.map((product) => (
                          <InlineStack
                            key={product.productId}
                            gap="200"
                            blockAlign="center"
                            wrap={false}
                          >
                            <Badge
                              tone={STATUS_TONE[product.status]}
                              size="small"
                            >
                              {product.status.toLowerCase()}
                            </Badge>
                            <Text as="span" variant="bodySm" truncate>
                              {product.title}
                            </Text>
                          </InlineStack>
                        ))}
                      </BlockStack>
                    </Box>
                  </div>
                );
              })}
            </div>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">
                {`Showing ${(activePage * PAGE_SIZE + 1).toLocaleString()}–${Math.min((activePage + 1) * PAGE_SIZE, groups.length).toLocaleString()} of ${groups.length.toLocaleString()} shared SKUs`}
              </Text>
              <Pagination
                hasPrevious={activePage > 0}
                hasNext={activePage < pageCount - 1}
                onPrevious={() => setPage(activePage - 1)}
                onNext={() => setPage(activePage + 1)}
              />
            </InlineStack>
          </BlockStack>
        </Box>
      </Collapsible>
    </Box>
  );
}
