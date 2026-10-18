import { shopifyGraphQL } from "./client";
import type { UserError } from "./types";

export interface MenuItem {
  id: string;
  title: string;
  type: string;
}

export interface MenuSummary {
  id: string;
  title: string;
  handle: string;
  items: MenuItem[];
}

const MENUS_QUERY = `
  query Menus($first: Int!) {
    menus(first: $first) {
      nodes {
        id
        title
        handle
        items { id title type }
      }
    }
  }
`;

export async function getMenus(): Promise<MenuSummary[]> {
  const data = await shopifyGraphQL<{ menus: { nodes: MenuSummary[] } }>(MENUS_QUERY, { first: 50 });
  return data.menus.nodes;
}

/**
 * A menu item to create — mirrors Shopify's own `MenuItemCreateInput`.
 * `items` nests one level of sub-menu items; Shopify itself supports
 * deeper nesting, but this app's own menu builder (manual or CSV) only
 * ever produces two levels (a top-level item and its direct children), so
 * that's all this type expresses.
 */
export interface MenuItemCreateInput {
  title: string;
  /** Always "HTTP" for a plain link like "#" — the only kind this app's menu builder produces today. */
  type: "HTTP";
  url: string;
  items?: MenuItemCreateInput[];
}

const MENU_CREATE_MUTATION = `
  mutation MenuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]) {
    menuCreate(title: $title, handle: $handle, items: $items) {
      menu { id title handle }
      userErrors { field message }
    }
  }
`;

export async function createMenu(
  title: string,
  handle: string,
  items: MenuItemCreateInput[],
): Promise<{ menu: { id: string; title: string; handle: string } | null; userErrors: UserError[] }> {
  const data = await shopifyGraphQL<{
    menuCreate: { menu: { id: string; title: string; handle: string } | null; userErrors: UserError[] };
  }>(MENU_CREATE_MUTATION, { title, handle, items });
  return data.menuCreate;
}
