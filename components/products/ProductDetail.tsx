"use client";

import { useActionState, useState, useTransition } from "react";
import {
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Checkbox,
  Tabs,
  Badge,
  Thumbnail,
  Button,
  Banner,
  InlineGrid,
  Box,
} from "@shopify/polaris";
import { Select } from "@/components/ui/Select";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { SuggestField } from "@/components/ui/SuggestField";
import { TagInput } from "@/components/ui/TagInput";
import { CollectionPicker } from "@/components/ui/CollectionPicker";
import { MediaPicker, type PickedImage } from "@/components/ui/MediaPicker";
import {
  saveProductAction,
  updateOrganizationAction,
  updateProductCollectionsAction,
  saveVariantDetailsAction,
  addProductImagesAction,
  removeProductImageAction,
  type SaveProductState,
} from "@/app/(app)/products/[id]/actions";
import { searchVendorsAction, searchTypesAction, searchTagsAction } from "@/app/(app)/products/new/actions";
import type { ProductDetail as ProductDetailType } from "@/lib/shopify/types";

const TAB_ITEMS = [
  { id: "details", content: "Details" },
  { id: "pricing", content: "Pricing & inventory" },
  { id: "media", content: "Media" },
  { id: "variants", content: "Variants" },
  { id: "seo", content: "SEO" },
];

const INITIAL_STATE: SaveProductState = { ok: true };

const WEIGHT_UNITS = [
  { label: "g", value: "GRAMS" },
  { label: "kg", value: "KILOGRAMS" },
  { label: "oz", value: "OUNCES" },
  { label: "lb", value: "POUNDS" },
];

export function ProductDetail({
  product,
  allCollections,
}: {
  product: ProductDetailType;
  allCollections: { id: string; title: string }[];
}) {
  const [tab, setTab] = useState(0);
  const variant = product.variants.nodes[0] ?? null;
  const boundAction = saveProductAction.bind(null, product.id, variant?.id ?? null);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL_STATE);

  const [title, setTitle] = useState(product.title);
  const [description, setDescription] = useState(product.descriptionHtml);

  // Pricing & inventory
  const [price, setPrice] = useState(variant?.price ?? "0.00");
  const [compareAtPrice, setCompareAtPrice] = useState(variant?.compareAtPrice ?? "");
  const [taxable, setTaxable] = useState(variant?.taxable ?? true);
  const [sku, setSku] = useState(variant?.sku ?? "");
  const [barcode, setBarcode] = useState(variant?.barcode ?? "");
  const [tracked, setTracked] = useState(variant?.inventoryItem.tracked ?? true);
  const [inventoryPolicy, setInventoryPolicy] = useState(variant?.inventoryPolicy ?? "DENY");
  const [weight, setWeight] = useState(String(variant?.inventoryItem.measurement.weight?.value ?? 0));
  const [weightUnit, setWeightUnit] = useState(variant?.inventoryItem.measurement.weight?.unit ?? "GRAMS");
  const [variantSaving, startVariantTransition] = useTransition();
  const [variantNotice, setVariantNotice] = useState<{ tone: "success" | "critical"; text: string } | null>(null);

  const variantDirty =
    price !== (variant?.price ?? "0.00") ||
    compareAtPrice !== (variant?.compareAtPrice ?? "") ||
    taxable !== (variant?.taxable ?? true) ||
    sku !== (variant?.sku ?? "") ||
    barcode !== (variant?.barcode ?? "") ||
    tracked !== (variant?.inventoryItem.tracked ?? true) ||
    inventoryPolicy !== (variant?.inventoryPolicy ?? "DENY") ||
    weight !== String(variant?.inventoryItem.measurement.weight?.value ?? 0);

  const saveVariant = () => {
    if (!variant) return;
    setVariantNotice(null);
    startVariantTransition(async () => {
      const result = await saveVariantDetailsAction(product.id, variant.id, {
        price,
        compareAtPrice: compareAtPrice || null,
        taxable,
        sku,
        barcode,
        tracked,
        inventoryPolicy: inventoryPolicy as "DENY" | "CONTINUE",
        weight: Number(weight) || 0,
        weightUnit: weightUnit as "GRAMS" | "KILOGRAMS" | "OUNCES" | "POUNDS",
      });
      setVariantNotice(
        result.ok
          ? { tone: "success", text: "Saved." }
          : { tone: "critical", text: result.error ?? "Couldn't save." },
      );
    });
  };

  // Organization
  const [vendor, setVendor] = useState(product.vendor);
  const [productType, setProductType] = useState(product.productType);
  const [tags, setTags] = useState<string[]>(product.tags);
  const [status, setStatus] = useState(product.status);
  const [collectionIds, setCollectionIds] = useState<string[]>(product.collections.nodes.map((c) => c.id));
  const [orgSaving, startOrgTransition] = useTransition();
  const [orgNotice, setOrgNotice] = useState<{ tone: "success" | "critical"; text: string } | null>(null);

  const orgDirty =
    vendor !== product.vendor ||
    productType !== product.productType ||
    status !== product.status ||
    JSON.stringify(tags) !== JSON.stringify(product.tags) ||
    JSON.stringify([...collectionIds].sort()) !== JSON.stringify(product.collections.nodes.map((c) => c.id).sort());

  const saveOrganization = () => {
    setOrgNotice(null);
    startOrgTransition(async () => {
      const originalCollectionIds = product.collections.nodes.map((c) => c.id);
      const addIds = collectionIds.filter((id) => !originalCollectionIds.includes(id));
      const removeIds = originalCollectionIds.filter((id) => !collectionIds.includes(id));

      const [orgResult, collectionsResult] = await Promise.all([
        updateOrganizationAction({ productGid: product.id, vendor, productType, tags, status }),
        addIds.length || removeIds.length
          ? updateProductCollectionsAction({ productGid: product.id, addIds, removeIds })
          : Promise.resolve({ ok: true as const }),
      ]);

      if (!orgResult.ok) {
        setOrgNotice({ tone: "critical", text: orgResult.error ?? "Couldn't save." });
        return;
      }
      if (!collectionsResult.ok) {
        setOrgNotice({ tone: "critical", text: collectionsResult.error ?? "Couldn't update collections." });
        return;
      }
      setOrgNotice({ tone: "success", text: "Saved." });
    });
  };

  // Media
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mediaPending, startMediaTransition] = useTransition();
  const [mediaNotice, setMediaNotice] = useState<{ tone: "success" | "critical"; text: string } | null>(null);

  const addImages = (images: PickedImage[]) => {
    if (images.length === 0) return;
    startMediaTransition(async () => {
      const result = await addProductImagesAction(
        product.id,
        images.map((img) => ({ url: img.url, altText: img.altText ?? undefined })),
      );
      setMediaNotice(
        result.ok
          ? { tone: "success", text: "Media added." }
          : { tone: "critical", text: result.error ?? "Couldn't add media." },
      );
    });
  };

  const removeImage = (mediaId: string) => {
    startMediaTransition(async () => {
      const result = await removeProductImageAction(product.id, mediaId);
      setMediaNotice(
        result.ok
          ? { tone: "success", text: "Image removed." }
          : { tone: "critical", text: result.error ?? "Couldn't remove image." },
      );
    });
  };

  return (
    <Layout>
      <Layout.Section>
        <Card padding="0">
          <Tabs tabs={TAB_ITEMS} selected={tab} onSelect={setTab} />
          <div style={{ padding: "1rem" }}>
            {tab === 0 && (
              <form action={formAction}>
                <input type="hidden" name="descriptionHtml" value={description} />
                <BlockStack gap="400">
                  {!state.ok && state.error && (
                    <Banner tone="critical" title="Couldn't save">
                      <p>{state.error}</p>
                    </Banner>
                  )}
                  <TextField
                    label="Title"
                    name="title"
                    autoComplete="off"
                    value={title}
                    onChange={setTitle}
                  />
                  <RichTextEditor label="Description" value={description} onChange={setDescription} />
                  <InlineStack>
                    <Button submit variant="primary" loading={pending}>
                      Save
                    </Button>
                  </InlineStack>
                </BlockStack>
              </form>
            )}

            {tab === 1 && (
              <BlockStack gap="400">
                {variantNotice && (
                  <Banner tone={variantNotice.tone} onDismiss={() => setVariantNotice(null)}>
                    <p>{variantNotice.text}</p>
                  </Banner>
                )}
                {!variant ? (
                  <Text as="p" tone="subdued">This product has no variant to price yet.</Text>
                ) : (
                  <>
                    <Text as="h3" variant="headingSm">Pricing</Text>
                    <InlineGrid columns={2} gap="300">
                      <TextField label="Price" type="number" prefix="$" autoComplete="off" value={price} onChange={setPrice} />
                      <TextField label="Compare-at price" type="number" prefix="$" autoComplete="off" value={compareAtPrice} onChange={setCompareAtPrice} />
                    </InlineGrid>
                    <Checkbox label="Charge tax on this product" checked={taxable} onChange={setTaxable} />

                    <Text as="h3" variant="headingSm">Inventory</Text>
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
                    <InlineStack gap="200" blockAlign="end">
                      <Text as="span" tone="subdued">Available</Text>
                      <Text as="span" numeric fontWeight="semibold">{variant.inventoryQuantity ?? 0}</Text>
                    </InlineStack>

                    <Text as="h3" variant="headingSm">Shipping</Text>
                    <InlineGrid columns={2} gap="300">
                      <TextField label="Weight" type="number" autoComplete="off" value={weight} onChange={setWeight} />
                      <Select label="Unit" options={WEIGHT_UNITS} value={weightUnit} onChange={setWeightUnit} />
                    </InlineGrid>

                    <InlineStack align="end">
                      <Button variant="primary" disabled={!variantDirty} loading={variantSaving} onClick={saveVariant}>
                        Save
                      </Button>
                    </InlineStack>
                  </>
                )}
              </BlockStack>
            )}

            {tab === 2 && (
              <BlockStack gap="300">
                {mediaNotice && (
                  <Banner tone={mediaNotice.tone} onDismiss={() => setMediaNotice(null)}>
                    <p>{mediaNotice.text}</p>
                  </Banner>
                )}
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">{product.images.nodes.length} images</Text>
                  <Button onClick={() => setPickerOpen(true)} disabled={mediaPending}>Add media</Button>
                </InlineStack>
                <InlineGrid columns={{ xs: 3, sm: 4, md: 5 }} gap="200">
                  {product.images.nodes.map((image) => (
                    <Box key={image.id} position="relative">
                      <Thumbnail source={image.url} alt={image.altText ?? product.title} size="large" />
                      <div style={{ position: "absolute", top: 2, right: 2 }}>
                        <Button
                          size="micro"
                          tone="critical"
                          disabled={mediaPending}
                          onClick={() => removeImage(image.id)}
                          accessibilityLabel="Remove image"
                        >
                          ✕
                        </Button>
                      </div>
                    </Box>
                  ))}
                </InlineGrid>
                <MediaPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={addImages} />
              </BlockStack>
            )}

            {tab === 3 && (
              <BlockStack gap="200">
                {product.variants.nodes.map((v) => (
                  <InlineStack key={v.id} align="space-between">
                    <Text as="span">{v.title}</Text>
                    <Text as="span" tone="subdued">{v.sku || "no sku"}</Text>
                    <Text as="span" numeric>${v.price}</Text>
                    <Text as="span" numeric>{v.inventoryQuantity ?? 0} available</Text>
                  </InlineStack>
                ))}
                <Text as="p" tone="subdued" variant="bodySm">
                  Multiple variants (e.g. Size/Color option combinations) aren&apos;t generated here yet — edit the default variant&apos;s pricing and inventory on the previous tab.
                </Text>
              </BlockStack>
            )}

            {tab === 4 && (
              <BlockStack gap="300">
                <Text as="p"><b>Page title:</b> {product.seo.title || product.title}</Text>
                <Text as="p"><b>Meta description:</b> {product.seo.description || "Not set."}</Text>
                <Text as="p"><b>URL handle:</b> /products/{product.handle}</Text>
              </BlockStack>
            )}
          </div>
        </Card>
      </Layout.Section>

      <Layout.Section variant="oneThird">
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="300" align="center">
              <Thumbnail
                source={product.images.nodes[0]?.url ?? ""}
                alt={product.title}
                size="large"
              />
              <Badge tone={product.status === "ACTIVE" ? "success" : "info"}>{product.status}</Badge>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm">Product organization</Text>
                {orgDirty && (
                  <Button size="slim" variant="primary" loading={orgSaving} onClick={saveOrganization}>
                    Save
                  </Button>
                )}
              </InlineStack>

              {orgNotice && (
                <Banner tone={orgNotice.tone} onDismiss={() => setOrgNotice(null)}>
                  <p>{orgNotice.text}</p>
                </Banner>
              )}

              <Select
                label="Status"
                options={[
                  { label: "Active", value: "ACTIVE" },
                  { label: "Draft", value: "DRAFT" },
                  { label: "Archived", value: "ARCHIVED" },
                ]}
                value={status}
                onChange={(v) => setStatus(v as typeof status)}
              />
              <SuggestField label="Vendor" value={vendor} onChange={setVendor} fetchSuggestions={searchVendorsAction} />
              <SuggestField label="Product type" value={productType} onChange={setProductType} fetchSuggestions={searchTypesAction} />
              <CollectionPicker
                label="Collections"
                options={allCollections}
                selected={collectionIds}
                onChange={setCollectionIds}
              />
              <TagInput label="Tags" values={tags} onChange={setTags} fetchSuggestions={searchTagsAction} />

              <InlineStack align="space-between">
                <Text as="span" tone="subdued">Total inventory</Text>
                <Text as="span" numeric>{product.totalInventory}</Text>
              </InlineStack>
            </BlockStack>
          </Card>
        </BlockStack>
      </Layout.Section>
    </Layout>
  );
}
