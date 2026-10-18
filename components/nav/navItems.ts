import type { IconProps } from "@shopify/polaris";
import {
  HomeIcon,
  OrderIcon,
  ProductIcon,
  PersonIcon,
  DiscountIcon,
  ContentIcon,
  GlobeIcon,
  ChartVerticalIcon,
  SettingsIcon,
  ImageIcon,
  DuplicateIcon,
  SearchIcon,
  PaintBrushFlatIcon,
  StoreIcon,
  MagicIcon,
  ImportIcon,
  ExchangeIcon,
  ColorIcon,
  PriceListIcon,
  ClockIcon,
  AlertDiamondIcon,
  InventoryIcon,
  CollectionIcon,
  LinkIcon,
} from "@shopify/polaris-icons";

type IconSource = IconProps["source"];

export interface NavLeaf {
  url: string;
  label: string;
}

export interface NavItem extends NavLeaf {
  icon: IconSource;
  /** Sub-pages, shown under the item when it is open. */
  children?: NavLeaf[];
}

export interface NavSection {
  id: string;
  /** Heading above the section; the first section has none. */
  title?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "main",
    items: [
      { url: "/home", label: "Home", icon: HomeIcon },
      { url: "/orders", label: "Orders", icon: OrderIcon },
      {
        url: "/products",
        label: "Products",
        icon: ProductIcon,
        children: [
          { url: "/products", label: "All products" },
          { url: "/products/collections", label: "Collections" },
          { url: "/products/collections/build", label: "Bulk collection builder" },
          { url: "/products/color-check", label: "Color variant checker" },
          { url: "/products/media-upload", label: "Media uploader" },
          { url: "/products/media-upload-sku", label: "Media uploader by SKU field" },
          { url: "/products/tag-bulk", label: "Bulk tag insert" },
          { url: "/products/content-update", label: "Content update by CSV" },
          { url: "/products/inventory", label: "Inventory" },
          { url: "/products/transfers", label: "Transfers" },
          { url: "/products/purchase-orders", label: "Purchase orders" },
          { url: "/products/gift-cards", label: "Gift cards" },
        ],
      },
      { url: "/customers", label: "Customers", icon: PersonIcon },
      { url: "/discounts", label: "Discounts", icon: DiscountIcon },
      {
        url: "/content",
        label: "Content",
        icon: ContentIcon,
        children: [
          { url: "/content/metaobjects", label: "Metaobjects" },
          { url: "/content/files", label: "Files" },
          { url: "/content/menus", label: "Menus" },
          { url: "/content/blog-posts", label: "Blog posts" },
        ],
      },
      { url: "/markets", label: "Markets", icon: GlobeIcon },
      { url: "/analytics", label: "Analytics", icon: ChartVerticalIcon },
    ],
  },
  {
    id: "setup",
    title: "Setup",
    items: [
      { url: "/settings/connection", label: "Store connection", icon: SettingsIcon },
      { url: "/design", label: "Design system", icon: ColorIcon },
    ],
  },
  {
    id: "tools",
    title: "Personal tools",
    items: [
      { url: "/tools/all-in-one", label: "All-in-one pipeline", icon: MagicIcon },
      { url: "/tools/media-converter", label: "Media format converter", icon: ImageIcon },
      { url: "/tools/bg-remover", label: "Background remover", icon: ImageIcon },
      { url: "/tools/bg-customiser", label: "Background customiser", icon: PaintBrushFlatIcon },
      { url: "/tools/metafield-copier", label: "Metafield copier", icon: DuplicateIcon },
      { url: "/tools/seo-audit", label: "SEO audit", icon: SearchIcon },
      { url: "/tools/store-scraper", label: "Store scraper", icon: StoreIcon },
      { url: "/tools/upload-products", label: "Upload Products & Update", icon: ImportIcon },
      { url: "/tools/store-compare", label: "Store compare", icon: ExchangeIcon },
    ],
  },
  {
    id: "merchant",
    title: "Merchant Tools",
    items: [
      { url: "/merchant/price-editor", label: "Bulk price editor", icon: PriceListIcon },
      { url: "/merchant/history", label: "Change history & undo", icon: ClockIcon },
      { url: "/merchant/data-health", label: "Data health", icon: AlertDiamondIcon },
      { url: "/merchant/reorder-planner", label: "Reorder planner", icon: InventoryIcon },
      { url: "/merchant/smart-collections", label: "Smart collections", icon: CollectionIcon },
      { url: "/merchant/image-fixer", label: "Image fixer", icon: ImageIcon },
      { url: "/merchant/redirects", label: "Redirect manager", icon: LinkIcon },
    ],
  },
];

export interface FlatNavEntry {
  url: string;
  label: string;
  /** The parent item or section a sub-page lives under, for "Products › Inventory" style results. */
  group: string;
}

/** Every page in the navigation as one list — used by search and to work out which item is current. */
export function flattenNav(): FlatNavEntry[] {
  const entries: FlatNavEntry[] = [];
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      entries.push({ url: item.url, label: item.label, group: section.title ?? "" });
      for (const child of item.children ?? []) {
        if (child.url === item.url) continue;
        entries.push({ url: child.url, label: child.label, group: item.label });
      }
    }
  }
  return entries;
}

/** The nav URL that best matches the current path: an exact match, else the longest URL the path sits under. */
export function activeNavUrl(pathname: string): string | null {
  let best: string | null = null;
  for (const entry of flattenNav()) {
    const matches = pathname === entry.url || pathname.startsWith(`${entry.url}/`);
    if (matches && (best === null || entry.url.length > best.length)) best = entry.url;
  }
  return best;
}
