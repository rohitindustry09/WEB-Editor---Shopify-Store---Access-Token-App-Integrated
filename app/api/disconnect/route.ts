import { NextResponse } from "next/server";
import { getAuthenticatedStore } from "@/lib/auth/session";
import { clearSession } from "@/lib/shopify/session";

export async function POST() {
  if (!(await getAuthenticatedStore())) {
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  }

  await clearSession();
  return NextResponse.json({ ok: true });
}
