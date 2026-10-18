import { NextResponse } from "next/server";
import { getAuthenticatedStore } from "@/lib/auth/session";
import { getSession } from "@/lib/shopify/session";
import { isSameOrigin } from "@/lib/sameOrigin";
import { cleanMetafields, cleanValues, LOCATION_GID, PRODUCT_GID, VARIANT_GID } from "@/lib/uploadApply";
import { scanUpToDate, type ScanItem } from "@/lib/shopify/upToDateScan";

export const dynamic = "force-dynamic";

const MAX_ITEMS_PER_REQUEST = 40;

/** Rebuilds each item from known shapes only; a malformed item rejects the whole request. */
function cleanItems(raw: unknown): ScanItem[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS_PER_REQUEST) return null;
  const items: ScanItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const { key, productId, variantId, values, metafields, locationId } = entry as Record<string, unknown>;
    const cleanedValues = cleanValues(values);
    const cleanedMetafields = cleanMetafields(metafields);
    if (typeof key !== "string" || key.length > 300 || !cleanedValues || !cleanedMetafields) return null;
    if (typeof productId !== "string" || !PRODUCT_GID.test(productId)) return null;
    if (variantId !== null && (typeof variantId !== "string" || !VARIANT_GID.test(variantId))) return null;
    items.push({
      key,
      productId,
      variantId: variantId as string | null,
      values: cleanedValues,
      metafields: cleanedMetafields,
      locationId: typeof locationId === "string" && LOCATION_GID.test(locationId) ? locationId : undefined,
    });
  }
  return items;
}

/**
 * Compares a batch of Upload & Update rows with the store (read only) and reports which are already up to
 * date. The client sends batches from several parallel requests, so thousands of rows are checked quickly.
 */
export async function POST(request: Request) {
  if (!(await getAuthenticatedStore()) || !(await getSession())) {
    return NextResponse.json({ error: "You're signed out or not connected to a store." }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }

  let items: ScanItem[] | null;
  try {
    items = cleanItems(((await request.json()) as { items?: unknown }).items);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!items) return NextResponse.json({ error: "Invalid rows." }, { status: 400 });

  try {
    return NextResponse.json({ results: await scanUpToDate(items) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't read the products from the store." }, { status: 502 });
  }
}
