"use server";

import { endAuthSession } from "@/lib/auth/session";
import { clearSession } from "@/lib/shopify/session";

export async function signOutAction(): Promise<void> {
  await endAuthSession();
  await clearSession();
}
