import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { getStoreFiles } from "@/lib/shopify/files";

export async function GET(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? undefined;

  try {
    const files = await getStoreFiles(q);
    return NextResponse.json({ ok: true, files });
  } catch (err) {
    const message =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Couldn't load files.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
