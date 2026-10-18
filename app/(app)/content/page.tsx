"use client";

import { Page } from "@shopify/polaris";
import { ContentIcon, ImageIcon, MenuHorizontalIcon, BlogIcon } from "@shopify/polaris-icons";
import { LinkTile, type TileColor } from "@/components/ui/LinkTile";

const SECTIONS: { href: string; label: string; description: string; icon: typeof ContentIcon; color: TileColor }[] = [
  { href: "/content/metaobjects", label: "Metaobjects", description: "Custom data types like colors, materials, and taxonomy attributes.", icon: ContentIcon, color: "violet" },
  { href: "/content/files", label: "Files", description: "Images and other assets uploaded to your store.", icon: ImageIcon, color: "sky" },
  { href: "/content/menus", label: "Menus", description: "Navigation menus used across your storefront.", icon: MenuHorizontalIcon, color: "emerald" },
  { href: "/content/blog-posts", label: "Blog posts", description: "Articles published to your store's blogs.", icon: BlogIcon, color: "amber" },
];

export default function ContentPage() {
  return (
    <Page fullWidth title="Content">
      <div className="bento">
        {SECTIONS.map((section, index) => (
          <LinkTile key={section.href} className="bento-span-6" href={section.href} title={section.label} text={section.description} icon={section.icon} color={section.color} delayMs={index * 60} />
        ))}
      </div>
    </Page>
  );
}
