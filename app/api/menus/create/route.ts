import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { createMenu, type MenuItemCreateInput } from "@/lib/shopify/menus";

interface CreateMenuBody {
  title?: string;
  handle?: string;
  items?: MenuItemCreateInput[];
}

export async function POST(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as CreateMenuBody;
    const title = body.title?.trim();
    const handle = body.handle?.trim();
    const items = body.items ?? [];

    if (!title) return NextResponse.json({ ok: false, error: "A menu name is required." }, { status: 400 });
    if (!handle) return NextResponse.json({ ok: false, error: "A menu handle is required." }, { status: 400 });
    if (items.length === 0) return NextResponse.json({ ok: false, error: "Add at least one menu item." }, { status: 400 });

    const { menu, userErrors } = await createMenu(title, handle, items);
    if (userErrors.length > 0 || !menu) {
      return NextResponse.json(
        { ok: false, error: userErrors.map((e) => e.message).join("; ") || "Couldn't create the menu." },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, menu });
  } catch (err) {
    const message =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Couldn't create the menu.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
