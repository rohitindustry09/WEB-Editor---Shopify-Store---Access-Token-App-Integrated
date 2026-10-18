import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { searchProducts } from "@/lib/shopify/collections";

export async function GET(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";

  try {
    const products = await searchProducts(q, 8);
    return NextResponse.json({ ok: true, products });
  } catch (err) {
    const message =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Search failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
