import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { createFileFromStagedUpload, createStagedUpload } from "@/lib/shopify/files";

export async function POST(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "No file provided." }, { status: 400 });
    }

    const { target, userErrors } = await createStagedUpload(file.name, file.type || "image/jpeg", file.size);
    if (userErrors.length > 0 || !target) {
      return NextResponse.json(
        { ok: false, error: userErrors.map((e) => e.message).join("; ") || "Couldn't start upload." },
        { status: 400 },
      );
    }

    const uploadForm = new FormData();
    for (const param of target.parameters) {
      uploadForm.append(param.name, param.value);
    }
    uploadForm.append("file", file);

    const uploadRes = await fetch(target.url, { method: "POST", body: uploadForm });
    if (!uploadRes.ok) {
      return NextResponse.json({ ok: false, error: "Upload to storage failed." }, { status: 502 });
    }

    const { file: created, userErrors: createErrors } = await createFileFromStagedUpload(
      target.resourceUrl,
      file.name,
    );
    if (createErrors.length > 0 || !created) {
      return NextResponse.json(
        { ok: false, error: createErrors.map((e) => e.message).join("; ") || "Couldn't register the file." },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, file: created });
  } catch (err) {
    const message =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Upload failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
