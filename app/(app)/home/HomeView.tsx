"use client";

import Link from "next/link";
import { useSyncExternalStore, type CSSProperties } from "react";
import { Page, Card, Text, BlockStack, InlineStack, Box, Button, Badge, Thumbnail } from "@shopify/polaris";
import {
  AlertCircleIcon,
  CashDollarIcon,
  MagicIcon,
  OrderIcon,
  ProductIcon,
  AlertTriangleIcon,
  ImportIcon,
  ImageIcon,
  ExchangeIcon,
  StoreIcon,
  PaintBrushFlatIcon,
  DuplicateIcon,
  SearchIcon,
  CollectionIcon,
} from "@shopify/polaris-icons";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { ResourceEmptyState } from "@/components/ui/ResourceEmptyState";
import { AnimatedIcon } from "@/components/motion/AnimatedIcon";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { AnimatedWords } from "@/components/motion/AnimatedWords";
import { LinkTile, type TileColor } from "@/components/ui/LinkTile";
import { formatMoney, idFromGid } from "@/lib/format";
import type { OrderListItem, ProductListItem, InventoryVariantNode } from "@/lib/shopify/types";

function financialBadgeTone(status: string): "success" | "warning" | "critical" | undefined {
  if (status === "PAID") return "success";
  if (status === "PENDING" || status === "PARTIALLY_PAID") return "warning";
  if (status === "REFUNDED" || status === "VOIDED") return "critical";
  return undefined;
}

function fulfillmentBadgeTone(status: string): "success" | "attention" | undefined {
  return status === "FULFILLED" ? "success" : "attention";
}

/** The greeting depends on the visitor's clock, which the server doesn't know — so the server and first render say the neutral "Welcome back" and the right one swaps in. */
const subscribeNever = (): (() => void) => () => {};
function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const SHORTCUTS: { url: string; title: string; text: string; icon: typeof MagicIcon; color: TileColor }[] = [
  { url: "/tools/upload-products", title: "Upload Products & Update", text: "Match a CSV by SKU, then create and update products, metafields, stock and publishing.", icon: ImportIcon, color: "brass" },
  { url: "/products/media-upload-sku", title: "Media uploader", text: "Upload a zip of product images, matched by any SKU field, with live progress.", icon: ImageIcon, color: "violet" },
  { url: "/tools/store-compare", title: "Store compare", text: "See what two Shopify stores share, and copy what's missing across.", icon: ExchangeIcon, color: "sky" },
  { url: "/tools/all-in-one", title: "All-in-one pipeline", text: "Background, logo, convert and upload in one run.", icon: MagicIcon, color: "rose" },
  { url: "/tools/bg-customiser", title: "Background customiser", text: "Swap backgrounds for whole folders of images.", icon: PaintBrushFlatIcon, color: "emerald" },
  { url: "/tools/store-scraper", title: "Store scraper", text: "Read another store's catalogue and export it.", icon: StoreIcon, color: "amber" },
  { url: "/tools/metafield-copier", title: "Metafield copier", text: "Copy a metafield between products in bulk.", icon: DuplicateIcon, color: "violet" },
  { url: "/products/collections/build", title: "Collection builder", text: "Turn a list of SKUs into a real collection.", icon: CollectionIcon, color: "rose" },
  { url: "/tools/seo-audit", title: "SEO audit", text: "Scan pages for on-page and technical SEO problems.", icon: SearchIcon, color: "emerald" },
];

export interface HomeViewProps {
  shopName: string;
  orders: OrderListItem[];
  products: ProductListItem[];
  inventoryVariants: InventoryVariantNode[];
  error: string | null;
}

export function HomeView({ shopName, orders, products, inventoryVariants, error }: HomeViewProps) {
  const greeting = useSyncExternalStore(subscribeNever, greetingForNow, () => "Welcome back");

  const today = new Date().toISOString().slice(0, 10);
  const todayOrders = orders.filter((o) => o.createdAt.slice(0, 10) === today);
  const revenueToday = todayOrders.reduce((sum, o) => sum + Number(o.totalPriceSet.shopMoney.amount), 0);
  const currencyCode = orders[0]?.totalPriceSet.shopMoney.currencyCode ?? "USD";

  const availableFor = (variant: InventoryVariantNode) =>
    variant.inventoryItem.inventoryLevels.nodes.reduce(
      (sum, level) => sum + (level.quantities.find((q) => q.name === "available")?.quantity ?? 0),
      0,
    );
  const lowStock = inventoryVariants.filter((v) => {
    const avail = availableFor(v);
    return avail > 0 && avail <= 10;
  }).length;
  const outOfStock = inventoryVariants.filter((v) => availableFor(v) === 0).length;

  return (
    <Page fullWidth>
      <BlockStack gap="400">
        {error && <ApiErrorBanner error={error} />}

        <div className="bento">
          <section className="bento-tile bento-hero bento-span-8" style={{ minHeight: "11rem", justifyContent: "space-between" }}>
            <div>
              <InlineStack gap="200" blockAlign="center">
                <AnimatedIcon source={MagicIcon} motion="float" trigger="always" size={18} />
                <Text as="span" variant="bodySm" tone="subdued">{shopName}</Text>
              </InlineStack>
              <h1 className="bento-title-gradient" style={{ margin: "0.5rem 0 0", fontSize: "2rem", fontWeight: 750, letterSpacing: "-0.03em", lineHeight: 1.15 }}>
                {greeting}.
                <br />
                <AnimatedWords text="Let's get things moving." delay={0.15} />
              </h1>
            </div>
            <InlineStack gap="200">
              <Button variant="primary" url="/tools/upload-products" icon={ImportIcon}>Upload & Update</Button>
              <Button url="/products/media-upload-sku" icon={ImageIcon}>Upload media</Button>
            </InlineStack>
          </section>

          <StatTile className="bento-span-4" label="Orders today" icon={OrderIcon} tint="rgba(14,165,233,0.13)" ink="#0369a1" inkDark="#7dd3fc" live>
            <AnimatedNumber value={todayOrders.length} />
          </StatTile>

          <StatTile className="bento-span-4" label="Revenue today" icon={CashDollarIcon} tint="rgba(16,185,129,0.13)" ink="#047857" inkDark="#6ee7b7">
            <AnimatedNumber value={Math.round(revenueToday * 100)} format={(cents) => formatMoney({ amount: String(cents / 100), currencyCode })} durationMs={900} />
          </StatTile>

          <StatTile className="bento-span-4" label="Low-stock variants" icon={AlertTriangleIcon} tint="rgba(245,158,11,0.14)" ink="#b45309" inkDark="#fcd34d">
            <AnimatedNumber value={lowStock} />
          </StatTile>

          <StatTile className="bento-span-4" label="Out-of-stock variants" icon={AlertCircleIcon} tint="rgba(244,63,94,0.12)" ink="#be123c" inkDark="#fda4af">
            <AnimatedNumber value={outOfStock} />
          </StatTile>
        </div>

        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">Jump back in</Text>
          <div className="bento">
            {SHORTCUTS.map((shortcut, index) => (
              <LinkTile key={shortcut.url} className="bento-span-4" href={shortcut.url} title={shortcut.title} text={shortcut.text} icon={shortcut.icon} color={shortcut.color} delayMs={index * 40} />
            ))}
          </div>
        </BlockStack>

        <div className="bento">
          <div className="bento-span-8" style={{ minWidth: 0 }}>
            <Card padding="0">
              <Box padding="400" borderBlockEndWidth="025" borderColor="border">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Recent orders</Text>
                  <Button url="/orders" variant="plain">View all</Button>
                </InlineStack>
              </Box>
              {orders.length === 0 ? (
                <Box padding="400">
                  <ResourceEmptyState heading="No orders yet">
                    <p>Orders will show up here as they come in.</p>
                  </ResourceEmptyState>
                </Box>
              ) : (
                <BlockStack gap="0">
                  {orders.slice(0, 5).map((order) => (
                    <Box key={order.id} padding="400" borderBlockEndWidth="025" borderColor="border">
                      <InlineStack align="space-between" blockAlign="center">
                        <Link href={`/orders/${idFromGid(order.id)}`}>
                          <Text as="span" fontWeight="semibold">{order.name}</Text>
                        </Link>
                        <Text as="span" tone="subdued">{order.customer?.displayName ?? "—"}</Text>
                        <Badge tone={financialBadgeTone(order.displayFinancialStatus)}>{order.displayFinancialStatus}</Badge>
                        <Badge tone={fulfillmentBadgeTone(order.displayFulfillmentStatus)}>{order.displayFulfillmentStatus}</Badge>
                        <Text as="span" fontWeight="medium">{formatMoney(order.totalPriceSet.shopMoney)}</Text>
                      </InlineStack>
                    </Box>
                  ))}
                </BlockStack>
              )}
            </Card>
          </div>

          <div className="bento-span-4" style={{ minWidth: 0 }}>
            <Card padding="0">
              <Box padding="400" borderBlockEndWidth="025" borderColor="border">
                <InlineStack gap="200" blockAlign="center">
                  <AnimatedIcon source={ProductIcon} motion="pop" size={18} />
                  <Text as="h2" variant="headingMd">Recently updated products</Text>
                </InlineStack>
              </Box>
              <BlockStack gap="0">
                {products.map((product) => (
                  <Box key={product.id} padding="300" borderBlockEndWidth="025" borderColor="border">
                    <InlineStack gap="300" blockAlign="center" wrap={false}>
                      <Thumbnail source={product.images.nodes[0]?.url ?? ""} alt={product.images.nodes[0]?.altText ?? product.title} size="small" />
                      <BlockStack gap="0">
                        <Link href={`/products/${idFromGid(product.id)}`}>
                          <Text as="span" truncate>{product.title}</Text>
                        </Link>
                        <Text as="span" tone="subdued" variant="bodySm">{product.variants.nodes[0]?.sku || product.handle}</Text>
                      </BlockStack>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            </Card>
          </div>
        </div>
      </BlockStack>
    </Page>
  );
}

function StatTile({
  className,
  label,
  icon,
  tint,
  ink,
  inkDark,
  live = false,
  children,
}: {
  className: string;
  label: string;
  icon: typeof MagicIcon;
  tint: string;
  ink: string;
  inkDark: string;
  /** Adds a quiet pulsing dot — for a number that is happening right now. */
  live?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`bento-tile ${className} has-icon-motion reveal`}
      style={{ "--tile-tint": tint, "--tile-ink": ink, "--tile-ink-dark": inkDark } as CSSProperties}
    >
      <InlineStack align="space-between" blockAlign="center">
        <span className="bento-icon"><AnimatedIcon source={icon} motion="pop" size={20} /></span>
        {live && <span className="live-dot" role="img" aria-label="Live" />}
      </InlineStack>
      <span className="bento-number">{children}</span>
      <span className="bento-text">{label}</span>
    </section>
  );
}
