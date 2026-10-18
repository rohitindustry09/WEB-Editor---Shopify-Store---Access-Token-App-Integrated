import { NextResponse } from "next/server";
import { getAuthenticatedStore } from "@/lib/auth/session";
import { getSession } from "@/lib/shopify/session";
import { isSameOrigin } from "@/lib/sameOrigin";
import {
  attachProductMediaAction,
  clearProductMediaAction,
  createStagedUploadsAction,
  deleteProductMediaIdsAction,
  getExistingMediaBatchAction,
  reorderProductMediaAction,
} from "@/app/(app)/products/media-upload/actions";

export const dynamic = "force-dynamic";

const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
const MAX_ITEMS = 250;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isProductId = (value: unknown): value is string => typeof value === "string" && PRODUCT_GID.test(value);
const isStringList = (value: unknown, max = MAX_ITEMS): value is string[] =>
  Array.isArray(value) && value.length <= max && value.every((v) => typeof v === "string" && v.length <= 2000);
const isObjectList = (value: unknown, max = MAX_ITEMS): value is Record<string, unknown>[] =>
  Array.isArray(value) && value.length <= max && value.every(isRecord);

const bad = (message: string) => NextResponse.json({ error: message }, { status: 400 });

/**
 * The Media uploader's per-product steps (look up images, prepare the upload,
 * attach, reorder, clear). The page used to call these as server actions, which
 * Next.js queues one at a time — so extra workers just waited in line. Route
 * requests run in parallel, which is what lets the Workers setting actually
 * upload several products at once. Each op runs the same code as before.
 */
export async function POST(request: Request) {
  if (!(await getAuthenticatedStore()) || !(await getSession())) {
    return NextResponse.json({ error: "You're signed out or not connected to a store." }, { status: 401 });
  }
  // A cookie-authenticated write must come from this site's own pages.
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request body.");
  }
  if (!isRecord(body) || typeof body.op !== "string" || !isRecord(body.args)) return bad("Invalid request.");
  const args = body.args;

  switch (body.op) {
    case "existing":
      if (!isStringList(args.productIds, 100) || !args.productIds.every(isProductId)) return bad("Invalid product ids.");
      return NextResponse.json(await getExistingMediaBatchAction(args.productIds));
    case "stage": {
      if (!isObjectList(args.files, 50)) return bad("Invalid files.");
      const files = args.files.map((f) => ({ filename: String(f.filename ?? ""), mimeType: String(f.mimeType ?? ""), fileSize: String(f.fileSize ?? "") }));
      if (files.some((f) => !f.filename || !f.mimeType || !/^\d+$/.test(f.fileSize))) return bad("Invalid files.");
      return NextResponse.json(await createStagedUploadsAction(files));
    }
    case "attach": {
      if (!isProductId(args.productId) || !isObjectList(args.files, 50)) return bad("Invalid attach request.");
      const files = args.files.map((f) => ({ resourceUrl: String(f.resourceUrl ?? ""), alt: String(f.alt ?? "") }));
      if (files.some((f) => !f.resourceUrl.startsWith("https://"))) return bad("Invalid upload URL.");
      return NextResponse.json(await attachProductMediaAction(args.productId, files));
    }
    case "reorder":
      if (!isProductId(args.productId) || !isStringList(args.orderedMediaIds)) return bad("Invalid reorder request.");
      return NextResponse.json(await reorderProductMediaAction(args.productId, args.orderedMediaIds));
    case "clear":
      if (!isProductId(args.productId)) return bad("Invalid product id.");
      return NextResponse.json(await clearProductMediaAction(args.productId));
    case "deleteIds":
      if (!isProductId(args.productId) || !isStringList(args.mediaIds)) return bad("Invalid delete request.");
      return NextResponse.json(await deleteProductMediaIdsAction(args.productId, args.mediaIds));
    default:
      return bad("Unknown operation.");
  }
}
