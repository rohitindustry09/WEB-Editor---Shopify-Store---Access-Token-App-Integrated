"use client";

import { useState, useTransition } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  TextField,
  Checkbox,
  Button,
  Banner,
  Text,
  Thumbnail,
  Box,
} from "@shopify/polaris";
import { Select } from "@/components/ui/Select";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { SuggestField } from "@/components/ui/SuggestField";
import { TagInput } from "@/components/ui/TagInput";
import { CollectionPicker } from "@/components/ui/CollectionPicker";
import { MediaPicker, type PickedImage } from "@/components/ui/MediaPicker";
import {
  createProductAction,
  searchVendorsAction,
  searchTypesAction,
  searchTagsAction,
} from "./actions";

const WEIGHT_UNITS = [
  { label: "g", value: "GRAMS" },
  { label: "kg", value: "KILOGRAMS" },
  { label: "oz", value: "OUNCES" },
  { label: "lb", value: "POUNDS" },
];

export function NewProductForm({ collections }: { collections: { id: string; title: string }[] }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [productType, setProductType] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [status, setStatus] = useState<"ACTIVE" | "DRAFT">("DRAFT");

  const [price, setPrice] = useState("");
  const [compareAtPrice, setCompareAtPrice] = useState("");
  const [taxable, setTaxable] = useState(true);
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [tracked, setTracked] = useState(true);
  const [inventoryPolicy, setInventoryPolicy] = useState<"DENY" | "CONTINUE">("DENY");
  const [weight, setWeight] = useState("0");
  const [weightUnit, setWeightUnit] = useState<"GRAMS" | "KILOGRAMS" | "OUNCES" | "POUNDS">("GRAMS");

  const [images, setImages] = useState<PickedImage[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createProductAction({
        title,
        descriptionHtml: description,
        vendor,
        productType,
        tags,
        collectionIds,
        status,
        price: price || undefined,
        compareAtPrice: compareAtPrice || undefined,
        sku: sku || undefined,
        barcode: barcode || undefined,
        tracked,
        weight: Number(weight) || 0,
        weightUnit,
        taxable,
        inventoryPolicy,
        imageUrls: images.map((i) => i.url),
      });
      if (!result.ok) setError(result.error ?? "Couldn't create product.");
    });
  };

  return (
    <Page fullWidth title="Add product" backAction={{ content: "Products", url: "/products" }}>
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Couldn't create product">
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <TextField label="Title" autoComplete="off" value={title} onChange={setTitle} autoFocus />
                <RichTextEditor label="Description" value={description} onChange={setDescription} />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingSm">Media</Text>
                  <Button onClick={() => setPickerOpen(true)}>Add media</Button>
                </InlineStack>
                {images.length === 0 ? (
                  <Text as="p" tone="subdued">No images yet.</Text>
                ) : (
                  <InlineGrid columns={{ xs: 3, sm: 4, md: 5 }} gap="200">
                    {images.map((img, i) => (
                      <Box key={img.url} position="relative">
                        <Thumbnail source={img.url} alt={img.altText ?? ""} size="large" />
                        <div style={{ position: "absolute", top: 2, right: 2 }}>
                          <Button
                            size="micro"
                            tone="critical"
                            accessibilityLabel="Remove image"
                            onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                          >
                            ✕
                          </Button>
                        </div>
                      </Box>
                    ))}
                  </InlineGrid>
                )}
                <MediaPicker
                  open={pickerOpen}
                  onClose={() => setPickerOpen(false)}
                  onSelect={(picked) => setImages((prev) => [...prev, ...picked])}
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingSm">Pricing</Text>
                <InlineGrid columns={2} gap="300">
                  <TextField label="Price" type="number" prefix="$" autoComplete="off" value={price} onChange={setPrice} />
                  <TextField label="Compare-at price" type="number" prefix="$" autoComplete="off" value={compareAtPrice} onChange={setCompareAtPrice} />
                </InlineGrid>
                <Checkbox label="Charge tax on this product" checked={taxable} onChange={setTaxable} />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingSm">Inventory</Text>
                <InlineGrid columns={2} gap="300">
                  <TextField label="SKU (Stock Keeping Unit)" autoComplete="off" value={sku} onChange={setSku} />
                  <TextField label="Barcode (ISBN, UPC, GTIN, etc.)" autoComplete="off" value={barcode} onChange={setBarcode} />
                </InlineGrid>
                <Checkbox label="Track quantity" checked={tracked} onChange={setTracked} />
                <Select
                  label="When out of stock"
                  options={[
                    { label: "Stop selling", value: "DENY" },
                    { label: "Continue selling", value: "CONTINUE" },
                  ]}
                  value={inventoryPolicy}
                  onChange={(v) => setInventoryPolicy(v as "DENY" | "CONTINUE")}
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingSm">Shipping</Text>
                <InlineGrid columns={2} gap="300">
                  <TextField label="Weight" type="number" autoComplete="off" value={weight} onChange={setWeight} />
                  <Select
                    label="Unit"
                    options={WEIGHT_UNITS}
                    value={weightUnit}
                    onChange={(v) => setWeightUnit(v as typeof weightUnit)}
                  />
                </InlineGrid>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingSm">Status</Text>
                <Select
                  label="Status"
                  labelHidden
                  options={[
                    { label: "Draft", value: "DRAFT" },
                    { label: "Active", value: "ACTIVE" },
                  ]}
                  value={status}
                  onChange={(v) => setStatus(v as "ACTIVE" | "DRAFT")}
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingSm">Product organization</Text>
                <SuggestField
                  label="Vendor"
                  value={vendor}
                  onChange={setVendor}
                  fetchSuggestions={searchVendorsAction}
                  placeholder="e.g. The Brasstown"
                />
                <SuggestField
                  label="Product type"
                  value={productType}
                  onChange={setProductType}
                  fetchSuggestions={searchTypesAction}
                  placeholder="e.g. Idol"
                />
                <CollectionPicker
                  label="Collections"
                  options={collections}
                  selected={collectionIds}
                  onChange={setCollectionIds}
                />
                <TagInput label="Tags" values={tags} onChange={setTags} fetchSuggestions={searchTagsAction} />
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <InlineStack align="end">
            <Button variant="primary" loading={pending} disabled={!title.trim()} onClick={submit}>
              Save product
            </Button>
          </InlineStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
