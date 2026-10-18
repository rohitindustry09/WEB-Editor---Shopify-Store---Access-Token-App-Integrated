import { redirect } from "next/navigation";
import { getAuthenticatedStore } from "@/lib/auth/session";
import { getSession } from "@/lib/shopify/session";

export default async function RootPage() {
  redirect((await getAuthenticatedStore()) && (await getSession()) ? "/home" : "/connect");
}
