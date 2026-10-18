"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Card,
  IndexTable,
  useIndexResourceState,
  Text,
  Badge,
  Thumbnail,
  TextField,
  ButtonGroup,
  Button,
  InlineStack,
  Box,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { CursorPagination } from "@/components/ui/CursorPagination";
import { idFromGid } from "@/lib/format";
import type { PageInfo, ProductListItem } from "@/lib/shopify/types";

const STATUS_TABS = ["all", "active", "draft", "archived"] as const;
const PAGE_SIZE = 50;

function statusTone(status: string): "success" | "info" | undefined {
  if (status === "ACTIVE") return "success";
  if (status === "DRAFT") return "info";
  return undefined;
}

export function ProductsIndexTable({
  products,
  initialQuery,
  initialStatus,
  page,
  pageInfo,
}: {
  products: ProductListItem[];
  initialQuery: string;
  initialStatus: (typeof STATUS_TABS)[number];
  page: number;
  pageInfo: PageInfo;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(initialQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushQuery = (query: string, status: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (query) params.set("query", query);
    else params.delete("query");
    if (status && status !== "all") params.set("status", status);
    else params.delete("status");
    params.delete("page");
    params.delete("after");
    params.delete("before");
    router.push(`/products?${params.toString()}`);
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (search !== initialQuery) pushQuery(search, initialStatus);
    }, 450);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const resourceName = { singular: "product", plural: "products" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(products as unknown as { [key: string]: unknown }[]);

  const rowMarkup = products.map((product, index) => {
    const id = idFromGid(product.id);
    const variant = product.variants.nodes[0];
    return (
      <IndexTable.Row id={product.id} key={product.id} selected={selectedResources.includes(product.id)} position={index}>
        <IndexTable.Cell>
          <InlineStack gap="300" blockAlign="center" wrap={false}>
            <Thumbnail
              source={product.images.nodes[0]?.url ?? ImageIcon}
              alt={product.images.nodes[0]?.altText ?? product.title}
              size="small"
            />
            <Link href={`/products/${id}`}>
              <Text as="span" fontWeight="semibold" truncate>
                {product.title}
              </Text>
            </Link>
          </InlineStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={statusTone(product.status)}>{product.status}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" tone={product.totalInventory === 0 ? "critical" : undefined} numeric>
            {product.totalInventory} in stock
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{product.productType || "—"}</IndexTable.Cell>
        <IndexTable.Cell>{product.vendor || "—"}</IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" numeric>{variant ? `$${variant.price}` : "—"}</Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Card padding="0">
      <Box padding="300">
        <InlineStack gap="300" align="space-between" blockAlign="center" wrap>
          <Box minWidth="280px">
            <TextField
              label="Search products"
              labelHidden
              placeholder="Search products or SKU…"
              value={search}
              onChange={setSearch}
              autoComplete="off"
              clearButton
              onClearButtonClick={() => setSearch("")}
            />
          </Box>
          <ButtonGroup variant="segmented">
            {STATUS_TABS.map((status) => (
              <Button
                key={status}
                pressed={initialStatus === status}
                onClick={() => pushQuery(search, status)}
              >
                {status === "all" ? "All" : status[0].toUpperCase() + status.slice(1)}
              </Button>
            ))}
          </ButtonGroup>
        </InlineStack>
      </Box>
      <IndexTable
        resourceName={resourceName}
        itemCount={products.length}
        selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
        onSelectionChange={handleSelectionChange}
        headings={[
          { title: "Product" },
          { title: "Status" },
          { title: "Inventory" },
          { title: "Product type" },
          { title: "Vendor" },
          { title: "Price" },
        ]}
        promotedBulkActions={[
          { content: "Add to collection", onAction: () => {} },
          { content: "Export", onAction: () => {} },
        ]}
      >
        {rowMarkup}
      </IndexTable>
      <Box padding="300" borderBlockStartWidth="025" borderColor="border">
        <CursorPagination
          page={page}
          pageSize={PAGE_SIZE}
          count={products.length}
          hasNextPage={pageInfo.hasNextPage}
          hasPreviousPage={pageInfo.hasPreviousPage}
          startCursor={pageInfo.startCursor}
          endCursor={pageInfo.endCursor}
        />
      </Box>
    </Card>
  );
}
