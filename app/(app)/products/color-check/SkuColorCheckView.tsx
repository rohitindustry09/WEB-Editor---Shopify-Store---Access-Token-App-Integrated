"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Button,
  Badge,
  Thumbnail,
  Banner,
  Box,
  Tag,
} from "@shopify/polaris";
import { idFromGid } from "@/lib/format";
import { ColorVariantPicker, type ColorLibraryEntry } from "@/components/products/ColorVariantPicker";
import { ColorOptionBadges } from "@/components/products/ColorOptionBadges";
import type { ExistingColorValue } from "@/lib/shopify/productOptions";
import { addColorVariantAction } from "./actions";

export interface SkuCheckResult {
  id: string;
  title: string;
  sku: string;
  imageUrl: string | null;
  categoryName: string | null;
  hasColor: boolean | null;
  error: string | null;
  existingColors: ExistingColorValue[];
}

interface SaveState {
  status: "idle" | "saving" | "saved" | "error";
  message?: string;
}

export function SkuColorCheckView({
  sku,
  results,
  searched,
  error,
  colorLibrary,
  colorLibraryError,
}: {
  sku: string;
  results: SkuCheckResult[];
  searched: boolean;
  error: string | null;
  colorLibrary: ColorLibraryEntry[];
  colorLibraryError: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(sku);
  const [pickerProductId, setPickerProductId] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, ColorLibraryEntry[]>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [pending, startTransition] = useTransition();

  const submit = () => {
    router.push(`/products/color-check?sku=${encodeURIComponent(value.trim())}`);
  };

  const save = (productId: string) => {
    const colors = selections[productId] ?? [];
    setSaveState((prev) => ({ ...prev, [productId]: { status: "saving" } }));
    startTransition(async () => {
      const result = await addColorVariantAction(
        productId,
        colors.map((c) => ({ id: c.id, name: c.name })),
      );
      const added = colors.length - (result.alreadyPresent?.length ?? 0);
      const addedMessage = added > 0 ? `Added ${added} color${added === 1 ? "" : "s"}.` : "";
      const alreadyMessage =
        result.alreadyPresent && result.alreadyPresent.length > 0
          ? `Already had: ${result.alreadyPresent.join(", ")}.`
          : "";
      setSaveState((prev) => ({
        ...prev,
        [productId]: result.ok
          ? { status: "saved", message: [addedMessage, alreadyMessage].filter(Boolean).join(" ") }
          : { status: "error", message: result.error },
      }));
    });
  };

  return (
    <Page
      fullWidth
      title="Color variant checker"
      backAction={{ content: "Products", url: "/products" }}
      secondaryActions={[{ content: "Bulk apply from CSV", url: "/products/color-check/bulk" }]}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">Check by SKU</Text>
              <Text as="p" tone="subdued">
                Enter a SKU to see every matching product — including duplicates sharing the same
                SKU — and whether its current category allows a Color variant option.
              </Text>
              <InlineStack gap="200" blockAlign="end">
                <Box width="280px">
                  <TextField
                    label="SKU"
                    labelHidden
                    autoComplete="off"
                    placeholder="e.g. BT-DIYA-002"
                    value={value}
                    onChange={setValue}
                  />
                </Box>
                <Button variant="primary" onClick={submit} disabled={!value.trim()}>
                  Check
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {colorLibraryError && (
          <Layout.Section>
            <Banner tone="warning" title="Color library unavailable">
              <p>{colorLibraryError} Adding a color variant needs it.</p>
            </Banner>
          </Layout.Section>
        )}

        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Couldn't search">
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {searched && !error && (
          <Layout.Section>
            {results.length === 0 ? (
              <Card>
                <Text as="p" tone="subdued">No products found with SKU &ldquo;{sku}&rdquo;.</Text>
              </Card>
            ) : (
              <BlockStack gap="300">
                <Text as="p" tone="subdued">
                  {results.length} product{results.length === 1 ? "" : "s"} matched
                </Text>
                {results.map((r) => {
                  const selected = selections[r.id] ?? [];
                  const save_ = saveState[r.id];
                  return (
                    <Card key={r.id}>
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center" wrap={false}>
                          <InlineStack gap="300" blockAlign="center" wrap={false}>
                            <Thumbnail source={r.imageUrl ?? ""} alt={r.title} size="small" />
                            <Box minWidth="0">
                              <BlockStack gap="050">
                                <Link href={`/products/${idFromGid(r.id)}`}>
                                  <Text as="span" fontWeight="semibold" truncate>{r.title}</Text>
                                </Link>
                                <Text as="span" tone="subdued" variant="bodySm">SKU {r.sku}</Text>
                                <Text as="span" tone="subdued" variant="bodySm">
                                  {r.categoryName ?? "No category set"}
                                </Text>
                              </BlockStack>
                            </Box>
                          </InlineStack>
                          {r.error ? (
                            <Badge tone="critical">Couldn&apos;t check</Badge>
                          ) : r.hasColor === null ? (
                            <Badge>No category</Badge>
                          ) : (
                            <Badge tone={r.hasColor ? "success" : "critical"}>
                              {r.hasColor ? "Color available" : "Color not available"}
                            </Badge>
                          )}
                        </InlineStack>

                        {r.error && (
                          <Text as="p" tone="critical" variant="bodySm">{r.error}</Text>
                        )}

                        <ColorOptionBadges values={r.existingColors} />

                        {r.hasColor && (
                          <BlockStack gap="200">
                            <InlineStack gap="200" blockAlign="center">
                              <Button onClick={() => setPickerProductId(r.id)} disabled={colorLibrary.length === 0}>
                                + Add color variant
                              </Button>
                              {selected.length > 0 && (
                                <Button
                                  variant="primary"
                                  loading={pending && save_?.status === "saving"}
                                  onClick={() => save(r.id)}
                                >
                                  Save changes
                                </Button>
                              )}
                            </InlineStack>

                            {selected.length > 0 && (
                              <InlineStack gap="150" wrap>
                                {selected.map((c) => (
                                  <Tag
                                    key={c.id}
                                    onRemove={() =>
                                      setSelections((prev) => ({
                                        ...prev,
                                        [r.id]: (prev[r.id] ?? []).filter((x) => x.id !== c.id),
                                      }))
                                    }
                                  >
                                    {c.name}
                                  </Tag>
                                ))}
                              </InlineStack>
                            )}

                            {save_?.status === "saved" && (
                              <Banner tone="success"><p>{save_.message}</p></Banner>
                            )}
                            {save_?.status === "error" && (
                              <Banner tone="critical"><p>{save_.message}</p></Banner>
                            )}
                          </BlockStack>
                        )}
                      </BlockStack>
                    </Card>
                  );
                })}
              </BlockStack>
            )}
          </Layout.Section>
        )}
      </Layout>

      <ColorVariantPicker
        open={pickerProductId !== null}
        onClose={() => setPickerProductId(null)}
        library={colorLibrary}
        selected={pickerProductId ? (selections[pickerProductId] ?? []) : []}
        onChange={(next) => {
          if (!pickerProductId) return;
          setSelections((prev) => ({ ...prev, [pickerProductId]: next }));
        }}
      />
    </Page>
  );
}
